import type { Bot, Middleware } from "grammy";
import { TmuxBridge } from "../services/tmux.js";
import type { AppConfig, BotCommand } from "../types.js";
import { validateCommand } from "../security.js";

const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;
const RATE_LIMIT_CLEANUP_THRESHOLD_MS = 20_000;
const MAX_RECENT_DIRS = 15;

async function appendRecentWorkdir(newPath: string): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const filePath = path.join(process.cwd(), "recent_workdir.txt");

  let lines: string[] = [];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    lines = content.split("\n").filter(Boolean);
  } catch {
    // File doesn't exist yet — start fresh
  }

  // Remove if already exists (will re-add at top to move it to front)
  lines = lines.filter((l) => l !== newPath);

  // Add to top
  lines.unshift(newPath);

  // Keep only last 15
  if (lines.length > MAX_RECENT_DIRS) {
    lines = lines.slice(0, MAX_RECENT_DIRS);
  }

  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
}

export const BOT_COMMANDS: BotCommand[] = [
  { command: "help", description: "Show all commands" },
  { command: "startup", description: "Launch Claude" },
  { command: "startup_continue", description: "Resume Claude with --continue" },
  { command: "peek", description: "Capture tmux pane" },
  { command: "esc", description: "Send Escape key" },
  { command: "enter", description: "Send Enter key" },
  { command: "interrupt", description: "Send Ctrl-C" },
  { command: "up", description: "Send Up arrow" },
  { command: "down", description: "Send Down arrow" },
  { command: "exit", description: "Send /exit to tmux" },
  { command: "clear", description: "Send /clear to tmux" },
  { command: "new", description: "Send /new to tmux" },
  { command: "run", description: "Send claude-* command to tmux" },
  { command: "cwd", description: "Change tmux working directory" },
  { command: "list_recent_workdir", description: "List recent working directories" },
  { command: "switch", description: "Switch to recent directory by number" },
  { command: "sessions", description: "List tmux sessions" },
];

// Per-user rate limiter with periodic cleanup to prevent memory leak
const rateLimit = new Map<string, number>();

// Periodic cleanup of stale rate limit entries
let rateLimitCleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startRateLimitCleanup(): void {
  if (rateLimitCleanupInterval) return;
  rateLimitCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [userId, ts] of rateLimit) {
      if (now - ts > RATE_LIMIT_CLEANUP_THRESHOLD_MS) {
        rateLimit.delete(userId);
      }
    }
  }, RATE_LIMIT_CLEANUP_INTERVAL_MS);
}

export function stopRateLimitCleanup(): void {
  if (rateLimitCleanupInterval) {
    clearInterval(rateLimitCleanupInterval);
    rateLimitCleanupInterval = null;
  }
}

type HandlerDeps = {
  bridge: TmuxBridge;
  config: AppConfig;
};

const RAW_KEY_COMMANDS: Record<string, string[]> = {
  "esc": ["Escape"],
  "enter": ["Enter"],
  "interrupt": ["C-c"],
  "up": ["Up"],
  "down": ["Down"],
};

const TEXT_COMMANDS: { name: string; text: string }[] = [
  { name: "exit", text: "/exit" },
  { name: "clear", text: "/clear" },
  { name: "new", text: "/new" },
];

const RUN_COMMAND_REGEX = /^\/run(?:@\w+)?\s+(\S+)\s+([\s\S]+)$/;

// Parse: /run [session] <cmd...>
// Session name is only recognized if it's a known tmux session (from config).
// This avoids mis-parsing commands like: /run plugin:telegram@claude-plugins-official --continue
// where "plugin:telegram" would otherwise be taken as the session name.
function parseRunCommand(text: string, knownSessions: string[]): { session: string | null; command: string } | null {
  const match = RUN_COMMAND_REGEX.exec(text);
  if (match) {
    const candidate = match[1]!.trim();
    if (knownSessions.includes(candidate)) {
      return { session: candidate, command: match[2]!.trim() };
    }
  }
  const noPrefix = text.replace(/^\/run(?:@\w+)?\s+/, "").trim();
  if (!noPrefix) return null;
  return { session: null, command: noPrefix };
}

function getBridge(deps: HandlerDeps, session: string | null): TmuxBridge {
  if (!session) return deps.bridge;
  return new TmuxBridge({ target: { ...deps.config.tmuxTarget, session } });
}

async function resolveHandlerContext(arg: string | null, deps: HandlerDeps): Promise<{ bridge: TmuxBridge; session: string }> {
  const session = arg ?? deps.config.tmuxTarget.session;
  const effectiveArg = arg === null || arg === "" ? null : arg;
  if (effectiveArg !== null && effectiveArg !== deps.config.tmuxTarget.session) {
    if (!(await deps.bridge.sessionExists(effectiveArg))) {
      throw new Error(`Session '${effectiveArg}' does not exist`);
    }
  }
  return {
    bridge: getBridge(deps, effectiveArg),
    session,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeTmuxCommand(ctx: any, session: string | null, command: string, deps: HandlerDeps): Promise<void> {
  const trimmed = command.trim();
  const { bridge, session: sessionName } = await resolveHandlerContext(session, deps);

  if (trimmed.length > deps.config.maxCommandLength) {
    await safeReply(ctx, `Command too long (max ${deps.config.maxCommandLength} chars).`);
    return;
  }

  const security = validateCommand(trimmed);
  if (!security.ok) {
    await safeReply(ctx, `Rejected: ${security.reason}`);
    return;
  }

  try {
    await bridge.ensurePaneExists();
    await bridge.sendCommand(trimmed);
    await safeReply(ctx, `✅ Sent '${trimmed}' to ${sessionName}`);
  } catch (err) {
    await safeReply(ctx, `Failed: ${errMessage(err)}`);
  }
}

// Build gramjs middleware: user allowlist + rate limit
export function buildMiddleware(config: AppConfig): Middleware {
  return async (ctx, next) => {
    const userId = String(ctx.from?.id ?? "");

    // User allowlist check
    if (config.allowedUserIds.size > 0 && !config.allowedUserIds.has(userId)) {
      await safeReply(ctx, "Access denied.");
      return;
    }

    // Rate limit check
    if (userId) {
      const last = rateLimit.get(userId) ?? 0;
      const now = Date.now();
      if (now - last < config.rateLimitMs) {
        await safeReply(ctx, "Too fast. Please wait a moment.");
        return;
      }
      rateLimit.set(userId, now);
    }

    return next();
  };
}

// Send reply safely, log on failure
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeReply(ctx: any, text: string, extra?: object): Promise<void> {
  try {
    await ctx.reply(text, extra);
  } catch (err) {
    console.error(`[handlers] reply failed: ${errMessage(err)}`);
  }
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerHandlers(bot: Bot, deps: HandlerDeps): void {
  startRateLimitCleanup();

  bot.command("help", async (ctx) => {
    await safeReply(ctx,
      "/peek [session] — capture tmux pane text\n" +
      "/esc [session] — send Escape key\n" +
      "/enter [session] — send Enter key\n" +
      "/interrupt [session] — send Ctrl-C\n" +
      "/up [session] — send Up arrow\n" +
      "/down [session] — send Down arrow\n" +
      "/exit [session] · /clear [session] · /new [session] — send command to tmux\n" +
      `/startup [session] — ${deps.config.claudeStartupCommand}\n` +
      `/startup_continue [session] — ${deps.config.claudeStartupCommand} --continue\n` +
      "/run <cmd> — send claude-<name> command (no extra args)\n" +
      "/cwd <path> — cd to path (allowed: " + deps.config.allowedCwdRoots.join(" · ") + ")\n" +
      "/list_recent_workdir — show recent directories with /switch_<n>\n" +
      "/switch_<n> — cd to recent directory by number\n" +
      "/sessions — list all tmux sessions\n\n" +
      "session is optional, defaults to configured TMUX_SESSION"
    );
  });

  bot.command("peek", async (ctx) => {
    const raw = ctx.match?.trim() ?? "";
    const arg = raw === "" ? null : raw;
    const { bridge, session } = await resolveHandlerContext(arg, deps);
    try {
      await bridge.ensurePaneExists();
      const snapshot = await bridge.capturePane();
      const trimmed = snapshot.trim();
      await safeReply(ctx,
        trimmed
          ? `📺 ${session}:\n\`\`\`\n${trimmed.slice(-3500)}\n\`\`\``
          : `📺 ${session}: (empty pane)`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await safeReply(ctx, `Peek failed: ${errMessage(err)}`);
    }
  });

  for (const [name, keys] of Object.entries(RAW_KEY_COMMANDS)) {
    bot.command(name, async (ctx) => {
      const raw = ctx.match?.trim() ?? "";
      const arg = raw === "" ? null : raw;
      const { bridge, session } = await resolveHandlerContext(arg, deps);
      try {
        await bridge.ensurePaneExists();
        for (const key of keys) {
          await bridge.sendRawKey(key);
        }
        await safeReply(ctx, `✅ Sent ${name} to ${session}`);
      } catch (err) {
        await safeReply(ctx, `${name} failed: ${errMessage(err)}`);
      }
    });
  }

  for (const { name, text } of TEXT_COMMANDS) {
    bot.command(name, async (ctx) => {
      const raw = ctx.match?.trim() ?? "";
      const arg = raw === "" ? null : raw;
      const { bridge, session } = await resolveHandlerContext(arg, deps);
      try {
        await bridge.ensurePaneExists();
        await bridge.sendCommand(text);
        await safeReply(ctx, `✅ Sent '${text}' to ${session}`);
      } catch (err) {
        await safeReply(ctx, `${name} failed: ${errMessage(err)}`);
      }
    });
  }

  for (const [name, text] of [
    ["startup", deps.config.claudeStartupCommand],
    ["startup_continue", `${deps.config.claudeStartupCommand} --continue`],
  ] as const) {
    bot.command(name, async (ctx) => {
      const raw = ctx.match?.trim() ?? "";
      const arg = raw === "" ? null : raw;
      const { bridge, session } = await resolveHandlerContext(arg, deps);
      try {
        await bridge.ensurePaneExists();
        await bridge.sendCommand(text);
        await safeReply(ctx, `✅ Sent '${text}' to ${session}`);
      } catch (err) {
        await safeReply(ctx, `${name} failed: ${errMessage(err)}`);
      }
    });
  }

  bot.command("sessions", async (ctx) => {
    try {
      const output = await deps.bridge.listSessions();
      await safeReply(ctx,
        output
          ? `🖥️ tmux sessions:\n\`\`\`\n${output}\n\`\`\``
          : "No tmux sessions running.",
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await safeReply(ctx, `Failed: ${errMessage(err)}`);
    }
  });

  bot.command("list_recent_workdir", async (ctx) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.join(process.cwd(), "recent_workdir.txt");

    let lines: string[] = [];
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      lines = content.split("\n").filter(Boolean);
    } catch {
      await safeReply(ctx, "No recent directories.");
      return;
    }

    if (lines.length === 0) {
      await safeReply(ctx, "No recent directories.");
      return;
    }

    const msg = lines
      .map((dir, i) => `${i + 1}. ${dir}\n/switch_${i + 1}`)
      .join("\n\n");

    await safeReply(ctx, `📁 Recent directories:\n\n${msg}`);
  });

  // Handler for /switch N (with space) — registered as bot.command
  bot.command("switch", async (ctx) => {
    const raw = (ctx.match as string)?.trim() ?? "";
    const match = raw.match(/^(\d+)$/);
    if (!match) {
      await safeReply(ctx, "Usage: /switch <n>\ne.g. /switch 1");
      return;
    }
    const idx = parseInt(match[1]!, 10) - 1;
    const fs = await import("node:fs");
    const pathModule = await import("node:path");
    const filePath = pathModule.join(process.cwd(), "recent_workdir.txt");

    let lines: string[] = [];
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      lines = content.split("\n").filter(Boolean);
    } catch {
      await safeReply(ctx, "No recent directories.");
      return;
    }

    if (idx < 0 || idx >= lines.length) {
      await safeReply(ctx, `Index out of range (1–${lines.length}).`);
      return;
    }

    const targetPath = lines[idx];
    const isAllowed = deps.config.allowedCwdRoots.some((root) => {
      const rootPath = root.startsWith("~") ? root.replace("~", process.env.HOME ?? "") : root;
      return targetPath.startsWith(rootPath);
    });

    if (!isAllowed) {
      await safeReply(ctx, `Path not allowed: ${targetPath}`);
      return;
    }

    try {
      await deps.bridge.ensurePaneExists();
      await deps.bridge.sendCommand(`cd ${targetPath} && pwd`);
      await appendRecentWorkdir(targetPath);
      await safeReply(ctx, `✅ cd to ${targetPath}`);
    } catch (err) {
      await safeReply(ctx, `Failed: ${errMessage(err)}`);
    }
  });

  bot.command("cwd", async (ctx) => {
    const raw = (ctx.match as string)?.trim() ?? "";
    if (!raw) {
      await safeReply(ctx, "Usage: /cwd <path>\nAllowed roots: " + deps.config.allowedCwdRoots.join(" · "));
      return;
    }

    // Only one argument — reject extra text
    const parts = raw.split(/\s+/);
    if (parts.length > 1) {
      await safeReply(ctx, "Usage: /cwd <path>\nOnly one path argument allowed.");
      return;
    }

    const targetPath = raw.startsWith("~") ? raw.replace("~", process.env.HOME ?? "") : raw;

    // Resolve symlinks to get real path
    const fs = await import("node:fs");
    let realPath: string;
    try {
      realPath = fs.realpathSync(targetPath);
    } catch {
      await safeReply(ctx, `Directory not found: ${targetPath}`);
      return;
    }

    // Check if path is under any allowed root
    const isAllowed = deps.config.allowedCwdRoots.some((root) => {
      const rootPath = root.startsWith("~") ? root.replace("~", process.env.HOME ?? "") : root;
      return realPath.startsWith(rootPath);
    });

    if (!isAllowed) {
      await safeReply(ctx, `Path not allowed. Only within: ${deps.config.allowedCwdRoots.join(" · ")}`);
      return;
    }

    try {
      await deps.bridge.ensurePaneExists();
      await deps.bridge.sendCommand(`cd ${realPath} && pwd`);
      await appendRecentWorkdir(realPath);
      await safeReply(ctx, `✅ cd to ${realPath}`);
    } catch (err) {
      await safeReply(ctx, `Failed: ${errMessage(err)}`);
    }
  });

  bot.command("run", async (ctx) => {
    const text = ctx.message?.text ?? "";
    const parsed = parseRunCommand(text, [deps.config.tmuxTarget.session]);
    if (!parsed) {
      await safeReply(ctx, "Usage: /run [session] <cmd>");
      return;
    }
    await executeTmuxCommand(ctx, parsed.session, parsed.command, deps);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;

    // Handle /switch_N format (underscore variant not routed by gramY command)
    const switchMatch = text.match(/^\/switch_(\d+)(?:\s|$)/);
    if (switchMatch) {
      const idx = parseInt(switchMatch[1]!, 10) - 1;
      const fs = await import("node:fs");
      const pathModule = await import("node:path");
      const filePath = pathModule.join(process.cwd(), "recent_workdir.txt");

      let lines: string[] = [];
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        lines = content.split("\n").filter(Boolean);
      } catch {
        await safeReply(ctx, "No recent directories.");
        return;
      }

      if (idx < 0 || idx >= lines.length) {
        await safeReply(ctx, `Index out of range (1–${lines.length}).`);
        return;
      }

      const targetPath = lines[idx];
      const isAllowed = deps.config.allowedCwdRoots.some((root) => {
        const rootPath = root.startsWith("~") ? root.replace("~", process.env.HOME ?? "") : root;
        return targetPath.startsWith(rootPath);
      });

      if (!isAllowed) {
        await safeReply(ctx, `Path not allowed: ${targetPath}`);
        return;
      }

      try {
        await deps.bridge.ensurePaneExists();
        await deps.bridge.sendCommand(`cd ${targetPath} && pwd`);
        await appendRecentWorkdir(targetPath);
        await safeReply(ctx, `✅ cd to ${targetPath}`);
      } catch (err) {
        await safeReply(ctx, `Failed: ${errMessage(err)}`);
      }
      return;
    }

    // Skip other command-like messages (let bot.command() handlers deal with them)
    if (text.startsWith("/")) return;

    const parsed = parseRunCommand(text, [deps.config.tmuxTarget.session]);
    if (!parsed) {
      await safeReply(ctx, `Received: ${text}\n\nUse /run [session] <cmd> to send commands.`);
      return;
    }
    await executeTmuxCommand(ctx, parsed.session, parsed.command, deps);
  });
}
