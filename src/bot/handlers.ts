import type { Bot, Middleware } from "grammy";
import * as fs from "node:fs";
import * as path from "node:path";
import { TmuxBridge } from "../services/tmux.js";
import { CurrentSessionManager } from "../services/currentSession.js";
import type { AppConfig, BotCommand } from "../types.js";
import { validateCommand } from "../security.js";
import { sessionShortId } from "../utils/hash.js";

/** Resolve a session name from a short hash (6-char base62) */
function resolveSessionByShortId(sessions: string[], shortId: string): string | null {
  return sessions.find((s) => sessionShortId(s) === shortId) ?? null;
}

const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;
const RATE_LIMIT_CLEANUP_THRESHOLD_MS = 20_000;
const MAX_RECENT_DIRS = 15;
const RECENT_WORKDIR_FILE = path.join(process.cwd(), "recent_workdir.txt");

function readRecentWorkdirLines(): string[] {
  try {
    return fs.readFileSync(RECENT_WORKDIR_FILE, "utf-8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function isPathAllowed(targetPath: string, allowedRoots: string[]): boolean {
  return allowedRoots.some((root) => {
    const rootPath = root.startsWith("~") ? root.replace("~", process.env.HOME ?? "") : root;
    return targetPath.startsWith(rootPath);
  });
}

async function appendRecentWorkdir(newPath: string): Promise<void> {
  const lines = readRecentWorkdirLines();
  const filtered = lines.filter((l) => l !== newPath);
  filtered.unshift(newPath);
  if (filtered.length > MAX_RECENT_DIRS) {
    filtered.length = MAX_RECENT_DIRS;
  }
  fs.writeFileSync(RECENT_WORKDIR_FILE, filtered.join("\n") + "\n", "utf-8");
}

async function switchToDir(ctx: any, idx: number, deps: HandlerDeps): Promise<void> {
  const lines = readRecentWorkdirLines();
  if (lines.length === 0) {
    await safeReply(ctx, "No recent directories.");
    return;
  }
  if (idx < 0 || idx >= lines.length) {
    await safeReply(ctx, `Index out of range (1–${lines.length}).`);
    return;
  }

  const targetPath = lines[idx];
  if (!isPathAllowed(targetPath, deps.config.allowedCwdRoots)) {
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
}

export async function switchToSession(ctx: any, idOrIdx: string | number, deps: HandlerDeps): Promise<void> {
  try {
    const sessions = await deps.bridge.listSessionNames();
    let sessionName: string | null = null;

    if (typeof idOrIdx === "string" && /^[a-zA-Z0-9]{6}$/.test(idOrIdx)) {
      sessionName = resolveSessionByShortId(sessions, idOrIdx);
    } else if (typeof idOrIdx === "number") {
      const current = await deps.currentSessionManager.get();
      const currentIdx = current ? sessions.indexOf(current) : -1;
      const prepend = current && currentIdx > 0 ? sessions[currentIdx] : null;
      const rest = prepend ? sessions.filter((_, i) => i !== currentIdx) : sessions;
      const sorted = prepend ? [prepend, ...rest] : sessions;
      if (idOrIdx >= 0 && idOrIdx < sorted.length) {
        sessionName = sorted[idOrIdx]!;
      }
    }

    if (!sessionName) {
      await safeReply(ctx, `Session not found for \`${idOrIdx}\`.`);
      return;
    }
    await deps.currentSessionManager.set(sessionName);
    await safeReply(ctx, `✅ Switched to ${sessionName}`);
  } catch (err) {
    await safeReply(ctx, `Failed: ${errMessage(err)}`);
  }
}

export async function removeSession(ctx: any, idOrIdx: string | number, deps: HandlerDeps): Promise<void> {
  try {
    const sessions = await deps.bridge.listSessionNames();
    let sessionName: string | null = null;

    if (typeof idOrIdx === "string" && /^[a-zA-Z0-9]{6}$/.test(idOrIdx)) {
      sessionName = resolveSessionByShortId(sessions, idOrIdx);
    } else if (typeof idOrIdx === "number") {
      const current = await deps.currentSessionManager.get();
      const currentIdx = current ? sessions.indexOf(current) : -1;
      const prepend = current && currentIdx > 0 ? sessions[currentIdx] : null;
      const rest = prepend ? sessions.filter((_, i) => i !== currentIdx) : sessions;
      const sorted = prepend ? [prepend, ...rest] : sessions;
      if (idOrIdx >= 0 && idOrIdx < sorted.length) {
        sessionName = sorted[idOrIdx]!;
      }
    }

    if (!sessionName) {
      await safeReply(ctx, `Session not found for \`${idOrIdx}\`.`);
      return;
    }
    await deps.bridge.killSession(sessionName);
    await safeReply(ctx, `✅ Removed session ${sessionName}`);
  } catch (err) {
    await safeReply(ctx, `Failed: ${errMessage(err)}`);
  }
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
  { command: "attach", description: "Switch tmux session by number" },
  { command: "remove", description: "Remove tmux session by number" },
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
  currentSessionManager: CurrentSessionManager;
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
export function parseRunCommand(text: string, knownSessions: string[]): { session: string | null; command: string } | null {
  const match = RUN_COMMAND_REGEX.exec(text);
  if (match) {
    const candidate = match[1]!.trim();
    if (knownSessions.includes(candidate)) {
      return { session: candidate, command: match[2]!.trim() };
    }
  }
  const noPrefix = text.replace(/^\/run(?:@\w+)?\s*/, "").trim();
  if (!noPrefix || noPrefix === text) return null;
  return { session: null, command: noPrefix };
}

function getBridge(deps: HandlerDeps, session: string | null): TmuxBridge {
  if (!session) return deps.bridge;
  return new TmuxBridge({ target: { ...deps.config.tmuxTarget, session } });
}

export async function resolveHandlerContext(arg: string | null, deps: HandlerDeps): Promise<{ bridge: TmuxBridge; session: string }> {
  const effectiveArg = arg === null || arg === "" ? null : arg;

  // Only read saved session from file when no explicit arg provided
  const savedSession = effectiveArg === null ? await deps.currentSessionManager.get() : null;
  let session = effectiveArg ?? savedSession ?? deps.config.tmuxTarget.session;

  if (!session) {
    throw new Error("No session specified. Run /sessions to see available sessions.");
  }

  // Auto-fallback: if saved session no longer exists, use default
  if (!(await deps.bridge.sessionExists(session))) {
    const defaultSession = deps.config.tmuxTarget.session;
    if (defaultSession && await deps.bridge.sessionExists(defaultSession)) {
      console.warn(`[handlers] Saved session '${session}' not found, falling back to '${defaultSession}'`);
      session = defaultSession;
    } else {
      throw new Error(`Session '${session}' does not exist`);
    }
  }

  return {
    bridge: getBridge(deps, effectiveArg ?? savedSession),
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

export function formatSessionsList(sessions: string[], current: string | null): string {
  if (sessions.length === 0) return "No tmux sessions running.";

  const currentIdx = current ? sessions.indexOf(current) : -1;
  const prepend = current && currentIdx > 0 ? sessions[currentIdx] : null;
  const rest = prepend ? sessions.filter((_, i) => i !== currentIdx) : sessions;
  const sorted = prepend ? [prepend, ...rest] : sessions;

  const lines = sorted.map((s) => {
    const marker = s === current ? "  ✅" : "   ";
    const sid = sessionShortId(s);
    return `${marker} ${s}\n   /attach_${sid}  /remove_${sid}`;
  });

  return `📌 Current: ${current ?? "(none)"}\n\n${lines.join("\n\n")}`;
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
      "/list_recent_workdir — show recent directories with /cwd_<n>\n" +
      "/cwd_<n> — cd to recent directory by number\n" +
      "/sessions — list tmux sessions\n" +
      "/attach <hash> — attach to tmux session by short hash\n" +
      "/remove <hash> — remove tmux session by short hash\n\n" +
      "session is optional — defaults to saved session from .current_tmux_session\n" +
      "run /sessions to see available hashes"
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
      const content = escapeHtml(trimmed.slice(-3500));
      await safeReply(ctx,
        trimmed
          ? `📺 ${session}:\n<pre>${content}</pre>`
          : `📺 ${session}: (empty pane)`,
        { parse_mode: "HTML" }
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
      const sessions = await deps.bridge.listSessionNames();
      const current = await deps.currentSessionManager.get();
      const body = formatSessionsList(sessions, current);
      await safeReply(ctx, `🖥️ tmux sessions:\n\n${body}`);
    } catch (err) {
      await safeReply(ctx, `Failed: ${errMessage(err)}`);
    }
  });

  // Handler for /attach <hash|n> — switches tmux session by short hash or legacy index
  bot.command("attach", async (ctx) => {
    const raw = (ctx.match as string)?.trim() ?? "";
    if (!raw) {
      await safeReply(ctx, "Usage: /attach <hash>\ne.g. /attach abc123\n\nUse /sessions to see available hashes.");
      return;
    }
    // Support both short hash (6-char base62) and legacy numeric index
    if (/^[a-zA-Z0-9]{6}$/.test(raw)) {
      await switchToSession(ctx, raw, deps);
    } else if (/^\d+$/.test(raw)) {
      const idx = parseInt(raw, 10) - 1;
      await switchToSession(ctx, idx, deps);
    } else {
      await safeReply(ctx, "Invalid session id. Use /sessions to see available hashes.");
    }
  });

  // Handler for /remove <hash|n> — kills tmux session by short hash or legacy index
  bot.command("remove", async (ctx) => {
    const raw = (ctx.match as string)?.trim() ?? "";
    if (!raw) {
      await safeReply(ctx, "Usage: /remove <hash>\ne.g. /remove abc123\n\nUse /sessions to see available hashes.");
      return;
    }
    if (/^[a-zA-Z0-9]{6}$/.test(raw)) {
      await removeSession(ctx, raw, deps);
    } else if (/^\d+$/.test(raw)) {
      const idx = parseInt(raw, 10) - 1;
      await removeSession(ctx, idx, deps);
    } else {
      await safeReply(ctx, "Invalid session id. Use /sessions to see available hashes.");
    }
  });

  bot.command("list_recent_workdir", async (ctx) => {
    const lines = readRecentWorkdirLines();
    if (lines.length === 0) {
      await safeReply(ctx, "No recent directories.");
      return;
    }

    const msg = lines
      .map((dir, i) => `${i + 1}. ${dir}\n/cwd_${i + 1}`)
      .join("\n\n");

    await safeReply(ctx, `📁 Recent directories:\n\n${msg}`);
  });

  bot.command("cwd", async (ctx) => {
    const raw = (ctx.match as string)?.trim() ?? "";
    if (!raw) {
      await safeReply(ctx, "Usage: /cwd <path>\nAllowed roots: " + deps.config.allowedCwdRoots.join(" · "));
      return;
    }

    const parts = raw.split(/\s+/);
    if (parts.length > 1) {
      await safeReply(ctx, "Usage: /cwd <path>\nOnly one path argument allowed.");
      return;
    }

    const targetPath = raw.startsWith("~") ? raw.replace("~", process.env.HOME ?? "") : raw;

    let realPath: string;
    try {
      realPath = fs.realpathSync(targetPath);
    } catch {
      await safeReply(ctx, `Directory not found: ${targetPath}`);
      return;
    }

    if (!isPathAllowed(realPath, deps.config.allowedCwdRoots)) {
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

    const cwdMatch = text.match(/^\/cwd_(\d+)(?:\s|$)/);
    if (cwdMatch) {
      const idx = parseInt(cwdMatch[1]!, 10) - 1;
      await switchToDir(ctx, idx, deps);
      return;
    }

    const attachMatch = text.match(/^\/attach_([a-zA-Z0-9]+)(?:\s|$)/);
    if (attachMatch) {
      const raw = attachMatch[1]!;
      if (/^[a-zA-Z0-9]{6}$/.test(raw)) {
        await switchToSession(ctx, raw, deps);
      } else if (/^\d+$/.test(raw)) {
        await switchToSession(ctx, parseInt(raw, 10) - 1, deps);
      }
      return;
    }

    const removeMatch = text.match(/^\/remove_([a-zA-Z0-9]+)(?:\s|$)/);
    if (removeMatch) {
      const raw = removeMatch[1]!;
      if (/^[a-zA-Z0-9]{6}$/.test(raw)) {
        await removeSession(ctx, raw, deps);
      } else if (/^\d+$/.test(raw)) {
        await removeSession(ctx, parseInt(raw, 10) - 1, deps);
      }
      return;
    }

    if (text.startsWith("/")) return;

    const parsed = parseRunCommand(text, [deps.config.tmuxTarget.session]);
    if (!parsed) {
      await safeReply(ctx, `Received: ${text}\n\nUse /run [session] <cmd> to send commands.`);
      return;
    }
    await executeTmuxCommand(ctx, parsed.session, parsed.command, deps);
  });
}
