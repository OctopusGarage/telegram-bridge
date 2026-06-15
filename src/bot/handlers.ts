import * as fs from "node:fs";
import * as path from "node:path";
import type { Bot, MiddlewareFn } from "grammy";
import { type MessageQueue, newMessageId, type QueuedMessage } from "../core/queue.js";
import { appStateFile } from "../core/state-dir.js";
import { validateCommand } from "../security.js";
import type { CurrentSessionManager } from "../services/currentSession.js";
import type { TmuxBridge } from "../services/tmux.js";
import type { AppConfig, BotCommand } from "../types.js";
import { sessionShortId } from "../utils/hash.js";
import { expandTilde } from "../utils/path.js";
import { shellQuote } from "../utils/shell.js";

/** Resolve a session name from a short hash (6-char base62) */
function resolveSessionByShortId(sessions: string[], shortId: string): string | null {
  return sessions.find((s) => sessionShortId(s) === shortId) ?? null;
}

const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;
const RATE_LIMIT_CLEANUP_THRESHOLD_MS = 20_000;
const QUEUE_STATUS_MAX_PREVIEW = 48;
const MAX_RECENT_DIRS = 15;
const getRecentWorkdirPath = (): string => appStateFile("recent_workdir.txt");
const DEFAULT_GLOBAL_RATE_KEY = "global";
const MAX_ALLOWED_CWD_CHARS = 1024;

function readLegacyRecentPaths(): string[] {
  try {
    return fs
      .readFileSync(path.join(process.cwd(), "recent_workdir.txt"), "utf-8")
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeRecentWorkdirLine(line: string, allowedRoots: string[] = []): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > MAX_ALLOWED_CWD_CHARS) {
    return null;
  }

  let candidate = trimmed;
  try {
    candidate = fs.realpathSync(trimmed);
  } catch {
    return null;
  }

  if (!isPathAllowed(candidate, allowedRoots)) {
    return null;
  }

  return candidate;
}

function writeRecentWorkdirLines(lines: string[]): void {
  const recentWorkdirPath = getRecentWorkdirPath();
  fs.mkdirSync(path.dirname(recentWorkdirPath), { recursive: true });
  if (lines.length === 0) {
    if (fs.existsSync(recentWorkdirPath)) {
      fs.rmSync(recentWorkdirPath);
    }
    return;
  }
  fs.writeFileSync(recentWorkdirPath, `${lines.join("\n")}\n`, "utf-8");
}

function readRecentWorkdirLines(allowedCwdRoots: string[] = []): string[] {
  const recentWorkdirPath = getRecentWorkdirPath();
  const fallbackLines = readLegacyRecentPaths();
  try {
    const rawLines = fs.readFileSync(recentWorkdirPath, "utf-8").split("\n");
    let normalized = Array.from(
      new Set(
        rawLines
          .map((line) => normalizeRecentWorkdirLine(line, allowedCwdRoots))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (normalized.length === 0 && fallbackLines.length > 0) {
      normalized = Array.from(
        new Set(
          fallbackLines
            .map((line) => normalizeRecentWorkdirLine(line, allowedCwdRoots))
            .filter((value): value is string => Boolean(value)),
        ),
      );
    }
    if (normalized.length !== rawLines.filter(Boolean).length) {
      writeRecentWorkdirLines(normalized);
    }
    return normalized;
  } catch {
    const legacy = fallbackLines;
    if (legacy.length > 0) {
      fs.mkdirSync(path.dirname(recentWorkdirPath), { recursive: true });
      const normalized = legacy
        .map((line) => normalizeRecentWorkdirLine(line, allowedCwdRoots))
        .filter((value): value is string => Boolean(value));
      writeRecentWorkdirLines(normalized);
      return normalized;
    }
    return [];
  }
}

function isPathAllowed(targetPath: string, allowedRoots: string[]): boolean {
  if (allowedRoots.length === 0) {
    return true;
  }
  return allowedRoots.some((root) => {
    const rootPath = expandTilde(root);
    const isInside = (base: string): boolean => {
      const rel = path.relative(path.resolve(base), targetPath);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    };
    try {
      const resolvedRoot = fs.realpathSync(rootPath);
      return isInside(resolvedRoot);
    } catch {
      return isInside(rootPath);
    }
  });
}

async function appendRecentWorkdir(newPath: string): Promise<void> {
  const normalized = normalizeRecentWorkdirLine(newPath, []);
  if (!normalized) return;

  const lines = readRecentWorkdirLines();
  const filtered = lines.filter((l) => l !== normalized);
  filtered.unshift(normalized);
  if (filtered.length > MAX_RECENT_DIRS) {
    filtered.length = MAX_RECENT_DIRS;
  }
  const recentWorkdirPath = getRecentWorkdirPath();
  fs.mkdirSync(path.dirname(recentWorkdirPath), { recursive: true });
  fs.writeFileSync(recentWorkdirPath, `${filtered.join("\n")}\n`, "utf-8");
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

  const targetPathRaw = lines[idx];
  let targetPath: string;

  try {
    targetPath = fs.realpathSync(targetPathRaw);
  } catch {
    await safeReply(ctx, `Directory not found: ${targetPathRaw}`);
    return;
  }

  if (!isPathAllowed(targetPath, deps.config.allowedCwdRoots)) {
    await safeReply(ctx, `Path not allowed: ${targetPath}`);
    return;
  }

  try {
    const { session } = await resolveHandlerContext(null, deps);
    await deps.bridge.ensurePaneExists(session);
    await deps.bridge.sendCommand(`cd ${shellQuote(targetPath)} && pwd`, session);
    await appendRecentWorkdir(targetPath);
    await safeReply(ctx, `✅ cd to ${targetPath}`);
  } catch (err) {
    await safeReply(ctx, `Failed: ${errMessage(err)}`);
  }
}

export async function switchToSession(
  ctx: any,
  idOrIdx: string | number,
  deps: HandlerDeps,
): Promise<void> {
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

export async function removeSession(
  ctx: any,
  idOrIdx: string | number,
  deps: HandlerDeps,
): Promise<void> {
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
  { command: "peek", description: "Capture tmux pane" },
  { command: "esc", description: "Send Escape key" },
  { command: "enter", description: "Send Enter key" },
  { command: "interrupt", description: "Send Ctrl-C" },
  { command: "up", description: "Send Up arrow" },
  { command: "down", description: "Send Down arrow" },
  { command: "exit", description: "Send /exit to tmux" },
  { command: "clear", description: "Send /clear to tmux" },
  { command: "new", description: "Send /new to tmux" },
  { command: "run", description: "Send an allowed command to tmux" },
  { command: "cwd", description: "Change tmux working directory" },
  { command: "clear_recent_workdir", description: "Clear recent directory history" },
  { command: "list_recent_workdir", description: "List recent working directories" },
  { command: "queue_status", description: "Show queue status" },
  { command: "attach", description: "Switch tmux session by number" },
  { command: "remove", description: "Remove tmux session by number" },
  { command: "sessions", description: "List tmux sessions" },
];

// Per-user, per-session and global rate limiter with periodic cleanup.
const rateLimit = new Map<string, number>();
const sessionRateLimit = new Map<string, number>();
const globalRateLimit = new Map<string, number>();

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
    for (const [sessionKey, ts] of sessionRateLimit) {
      if (now - ts > RATE_LIMIT_CLEANUP_THRESHOLD_MS) {
        sessionRateLimit.delete(sessionKey);
      }
    }
    for (const [scope, ts] of globalRateLimit) {
      if (now - ts > RATE_LIMIT_CLEANUP_THRESHOLD_MS) {
        globalRateLimit.delete(scope);
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
  queue: MessageQueue;
};

const RAW_KEY_COMMANDS: Record<string, string[]> = {
  esc: ["Escape"],
  enter: ["Enter"],
  interrupt: ["C-c"],
  up: ["Up"],
  down: ["Down"],
};

const TEXT_COMMANDS: { name: string; text: string }[] = [
  { name: "exit", text: "/exit" },
  { name: "clear", text: "/clear" },
  { name: "new", text: "/new" },
];

const RUN_COMMAND_REGEX = /^\/run(?:@\w+)?\s+(\S+)\s+([\s\S]+)$/;

// Parse: /run [session] <cmd...>
// Session name is only recognized if it's a known tmux session (from config).
// This avoids mis-parsing commands like: /run some-tool --flag=a:b
// where "some-tool" would otherwise be taken as the session name.
export function parseRunCommand(
  text: string,
  knownSessions: string[],
): { session: string | null; command: string } | null {
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

function getBridge(deps: HandlerDeps, _session: string | null): TmuxBridge {
  return deps.bridge;
}

export async function resolveHandlerContext(
  arg: string | null,
  deps: HandlerDeps,
): Promise<{ bridge: TmuxBridge; session: string }> {
  const effectiveArg = arg === null || arg === "" ? null : arg;

  // Only read saved session from file when no explicit arg provided
  const savedSession = effectiveArg === null ? await deps.currentSessionManager.get() : null;
  const explicit = effectiveArg ?? savedSession;

  // An explicitly-specified session (command arg or saved current session) is
  // only honored if it actually exists — never fabricate an arbitrary name.
  if (explicit && (await deps.bridge.sessionExists(explicit))) {
    return { bridge: getBridge(deps, explicit), session: explicit };
  }

  // Otherwise fall back to the configured default session, creating that default
  // on demand only when a command is received and it doesn't exist yet.
  const session = deps.config.tmuxTarget.session;
  if (!session) {
    throw new Error("No session specified. Run /sessions to see available sessions.");
  }
  if (!(await deps.bridge.sessionExists(session))) {
    await deps.bridge.ensureSession(session);
  }
  return { bridge: getBridge(deps, session), session };
}

export async function executeQueuedCommand(msg: QueuedMessage, deps: HandlerDeps): Promise<void> {
  const session = msg.sessionName;
  try {
    await deps.bridge.ensurePaneExists(session);
    if (msg.action === "raw-key") {
      await deps.bridge.sendRawKey(msg.text, session);
      msg.resolve(`✅ Sent ${msg.text} to ${session}`);
      return;
    }
    if (msg.action === "command") {
      await deps.bridge.sendCommand(msg.text, session);
      msg.resolve(`✅ Sent '${msg.text}' to ${session}`);
      return;
    }
    msg.reject(new Error(`Unknown action: ${msg.action}`));
  } catch (err) {
    msg.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

async function enqueueAction(
  ctx: any,
  sessionArg: string | null,
  action: string,
  value: string,
  deps: HandlerDeps,
): Promise<void> {
  const { session } = await resolveHandlerContext(sessionArg, deps);
  const now = Date.now();
  const chatId = String(ctx.chat?.id ?? "");
  const userSessionKey = `${chatId}:${session}`;
  const lastSession = sessionRateLimit.get(userSessionKey) ?? 0;
  if (now - lastSession < deps.config.sessionRateLimitMs) {
    await safeReply(
      ctx,
      `Session is busy. Try again in ${Math.max(1, Math.ceil((deps.config.sessionRateLimitMs - (now - lastSession)) / 1000))}s.`,
    );
    return;
  }
  const lastGlobal = globalRateLimit.get(DEFAULT_GLOBAL_RATE_KEY) ?? 0;
  if (now - lastGlobal < deps.config.globalRateLimitMs) {
    await safeReply(ctx, "Queue is temporarily throttled. Please wait a moment.");
    return;
  }

  const queueSizeBefore = deps.queue.size(session);
  const verdict = deps.queue.enqueue({
    id: newMessageId(),
    text: value,
    chatId: ctx.chat?.id ?? 0,
    sessionName: session,
    action,
    resolve: (output) => {
      void safeReply(ctx, output);
    },
    reject: (err) => {
      void safeReply(ctx, `Failed: ${errMessage(err)}`);
    },
  });
  sessionRateLimit.set(userSessionKey, now);
  globalRateLimit.set(DEFAULT_GLOBAL_RATE_KEY, now);

  if (verdict === false) {
    await safeReply(ctx, `Queue full (max ${deps.config.maxQueueSize}).`);
    return;
  }
  if (queueSizeBefore === 0) {
    await safeReply(ctx, `✅ Sent to ${session}`);
  } else {
    await safeReply(ctx, `⏳ Queued for ${session} (ahead: ${queueSizeBefore})`);
  }
}

function enqueueTextCommand(
  ctx: any,
  session: string | null,
  command: string,
  deps: HandlerDeps,
): Promise<void> {
  const trimmed = command.trim();
  if (trimmed.length > deps.config.maxCommandLength) {
    return safeReply(ctx, `Command too long (max ${deps.config.maxCommandLength} chars).`);
  }
  const security = validateCommand(trimmed, deps.config.allowedRunPatterns);
  if (!security.ok) {
    return safeReply(ctx, `Rejected: ${security.reason}`);
  }
  return enqueueAction(ctx, session, "command", trimmed, deps);
}

// Build gramjs middleware: user allowlist + rate limit
export function buildMiddleware(config: AppConfig): MiddlewareFn {
  return async (ctx, next) => {
    const userId = String(ctx.from?.id ?? "");

    // User allowlist check (fail closed): access requires either an explicit
    // ALLOW_ALL_USERS opt-in or membership in the allowlist. An empty allowlist
    // therefore denies everyone instead of allowing the world.
    const userAllowed = config.allowAllUsers || config.allowedUserIds.has(userId);
    if (!userAllowed) {
      await safeReply(ctx, "Access denied.");
      return;
    }

    // Rate limit check
    if (userId) {
      const last = rateLimit.get(userId);
      const now = Date.now();
      if (last !== undefined && now - last < config.rateLimitMs) {
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

function shortenForStatus(text: string, maxLen = QUEUE_STATUS_MAX_PREVIEW): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function formatQueueStatus(deps: HandlerDeps): string {
  const lines: string[] = [];
  const total = deps.queue.size();
  lines.push(
    `📬 Queue status (max per session: ${deps.config.maxQueueSize}, concurrent sessions: ${deps.config.maxConcurrentSessions})`,
  );
  lines.push(`Queued items: ${total}`);

  const sessions = deps.queue.getSessionNames().sort();
  if (sessions.length === 0) {
    lines.push("No pending messages.");
    return lines.join("\n");
  }

  for (const sessionName of sessions) {
    const sessionQueue = deps.queue.getSessionQueue(sessionName);
    const current = deps.queue.getCurrentMessage(sessionName);
    const running = deps.queue.isSessionProcessing(sessionName);
    lines.push(`\n📂 ${sessionName} (${running ? "running" : "waiting"})`);
    lines.push(`  queued: ${sessionQueue.length}`);
    if (current) {
      lines.push(`  ▶ ${shortenForStatus(current.text)}`);
    }
    sessionQueue.forEach((msg, index) => {
      lines.push(`  ${index + 1}. ${shortenForStatus(msg.text)}`);
    });
  }
  return lines.join("\n");
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
    await safeReply(
      ctx,
      "/peek [session] — capture tmux pane text\n" +
        "/esc [session] — send Escape key\n" +
        "/enter [session] — send Enter key\n" +
        "/interrupt [session] — send Ctrl-C\n" +
        "/up [session] — send Up arrow\n" +
        "/down [session] — send Down arrow\n" +
        "/exit [session] · /clear [session] · /new [session] — send command to tmux\n" +
        "/run [session] <cmd> — send an allowed command (see ALLOWED_RUN_PATTERNS)\n" +
        "/cwd <path> — cd to path (allowed: " +
        deps.config.allowedCwdRoots.join(" · ") +
        ")\n" +
        "/clear_recent_workdir — clear recent directory history\n" +
        "/queue_status — show pending queue and current execution status\n" +
        "/list_recent_workdir — show recent directories with /cwd_<n>\n" +
        "/cwd_<n> — cd to recent directory by number\n" +
        "/sessions — list tmux sessions\n" +
        "/attach <hash> — attach to tmux session by short hash\n" +
        "/remove <hash> — remove tmux session by short hash\n\n" +
        "session is optional — defaults to saved session from .current_tmux_session\n" +
        "run /sessions to see available hashes",
    );
  });

  bot.command("peek", async (ctx) => {
    const raw = ctx.match?.trim() ?? "";
    const arg = raw === "" ? null : raw;
    const { bridge, session } = await resolveHandlerContext(arg, deps);
    try {
      await bridge.ensurePaneExists(session);
      const snapshot = await bridge.capturePane(session);
      const trimmed = snapshot.trim();
      const content = escapeHtml(trimmed.slice(-3500));
      await safeReply(
        ctx,
        trimmed ? `📺 ${session}:\n<pre>${content}</pre>` : `📺 ${session}: (empty pane)`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      await safeReply(ctx, `Peek failed: ${errMessage(err)}`);
    }
  });

  for (const [name, keys] of Object.entries(RAW_KEY_COMMANDS)) {
    bot.command(name, async (ctx) => {
      const raw = ctx.match?.trim() ?? "";
      const arg = raw === "" ? null : raw;
      await enqueueAction(ctx, arg, "raw-key", keys[0]!, deps);
    });
  }

  for (const { name, text } of TEXT_COMMANDS) {
    bot.command(name, async (ctx) => {
      const raw = ctx.match?.trim() ?? "";
      const arg = raw === "" ? null : raw;
      await enqueueTextCommand(ctx, arg, text, deps);
    });
  }

  bot.command("queue_status", async (ctx) => {
    await safeReply(ctx, formatQueueStatus(deps));
  });

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
      await safeReply(
        ctx,
        "Usage: /attach <hash>\ne.g. /attach abc123\n\nUse /sessions to see available hashes.",
      );
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
      await safeReply(
        ctx,
        "Usage: /remove <hash>\ne.g. /remove abc123\n\nUse /sessions to see available hashes.",
      );
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

  bot.command("clear_recent_workdir", async (ctx) => {
    writeRecentWorkdirLines([]);
    await safeReply(ctx, "🧹 Cleared recent directories.");
  });

  bot.command("list_recent_workdir", async (ctx) => {
    const lines = readRecentWorkdirLines(deps.config.allowedCwdRoots);
    if (lines.length === 0) {
      await safeReply(ctx, "No recent directories.");
      return;
    }

    const msg = lines.map((dir, i) => `${i + 1}. ${dir}\n/cwd_${i + 1}`).join("\n\n");

    await safeReply(ctx, `📁 Recent directories:\n\n${msg}`);
  });

  bot.command("cwd", async (ctx) => {
    const raw = (ctx.match as string)?.trim() ?? "";
    if (!raw) {
      await safeReply(
        ctx,
        `Usage: /cwd <path>\nAllowed roots: ${deps.config.allowedCwdRoots.join(" · ")}`,
      );
      return;
    }

    const parts = raw.split(/\s+/);
    if (parts.length > 1) {
      await safeReply(ctx, "Usage: /cwd <path>\nOnly one path argument allowed.");
      return;
    }

    const targetPath = expandTilde(raw);

    let realPath: string;
    try {
      realPath = fs.realpathSync(targetPath);
    } catch {
      await safeReply(ctx, `Directory not found: ${targetPath}`);
      return;
    }

    if (!isPathAllowed(realPath, deps.config.allowedCwdRoots)) {
      await safeReply(
        ctx,
        `Path not allowed. Only within: ${deps.config.allowedCwdRoots.join(" · ")}`,
      );
      return;
    }

    await appendRecentWorkdir(realPath);
    await enqueueAction(ctx, null, "command", `cd ${shellQuote(realPath)} && pwd`, deps);
  });

  bot.command("run", async (ctx) => {
    const text = ctx.message?.text ?? "";
    const parsed = parseRunCommand(text, [deps.config.tmuxTarget.session]);
    if (!parsed) {
      await safeReply(ctx, "Usage: /run [session] <cmd>");
      return;
    }
    await enqueueTextCommand(ctx, parsed.session, parsed.command, deps);
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
    await enqueueTextCommand(ctx, parsed.session, parsed.command, deps);
  });
}
