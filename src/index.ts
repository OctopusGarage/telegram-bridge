import { Bot } from "grammy";
import { fetch, ProxyAgent } from "undici";
import {
  BOT_COMMANDS,
  buildMiddleware,
  errMessage,
  executeQueuedCommand,
  registerHandlers,
  stopRateLimitCleanup,
} from "./bot/handlers.js";
import { loadConfig } from "./config.js";
import {
  acquireInstanceLock,
  InstanceLockHeldError,
  releaseInstanceLock,
} from "./core/instance-lock.js";
import { detectUncleanRestart, markCleanShutdown } from "./core/lifecycle.js";
import { MessageQueue, type PersistedMessage } from "./core/queue.js";
import { CurrentSessionManager } from "./services/currentSession.js";
import { TmuxBridge } from "./services/tmux.js";

const config = loadConfig();
if (config.allowAllUsers) {
  console.warn(
    "[bot] ALLOW_ALL_USERS=true — user allowlist is DISABLED; anyone who reaches this bot can control your tmux pane.",
  );
} else if (config.allowedUserIds.size === 0) {
  console.warn(
    "[bot] ALLOWED_USER_IDS is empty and ALLOW_ALL_USERS is not set — all users will be denied. Set ALLOWED_USER_IDS to grant access.",
  );
}
const bridge = new TmuxBridge({ target: config.tmuxTarget });
const currentSessionManager = new CurrentSessionManager();

const bot = new Bot(config.botToken, {
  client: {
    fetch: config.proxyUrl
      ? async (url: URL | RequestInfo, init?: RequestInit) => {
          const { signal: _signal, ...rest } = init || {};
          const dispatcher = new ProxyAgent(config.proxyUrl!);
          const requestUrl = typeof url === "string" || url instanceof URL ? url : url.url;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return fetch(requestUrl, { ...rest, dispatcher } as any);
        }
      : undefined,
  },
});

const queue = new MessageQueue(config.maxQueueSize, undefined, config.maxConcurrentSessions);
queue.setHandler((msg) =>
  executeQueuedCommand(msg, { bridge, config, currentSessionManager, queue }),
);

// Apply user allowlist + rate limit middleware
bot.use(buildMiddleware(config));

const restored: PersistedMessage[] = queue.loadPersisted();
if (restored.length > 0) {
  console.log(`[bot] Restored ${restored.length} queued message(s) from previous shutdown`);
  queue.clearPersisted();
  for (const msg of restored) {
    const result = queue.enqueue({
      id: msg.id,
      text: msg.text,
      chatId: msg.chatId,
      sessionName: msg.sessionName,
      action: msg.action,
      resolve: () => {},
      reject: (err) => {
        console.warn(`[queue] dropped restored message ${msg.id}: ${err.message}`);
      },
    });
    if (result === false) {
      console.warn(`[queue] cannot restore ${msg.id}: queue full`);
    } else if (result === "duplicate") {
      console.warn(`[queue] cannot restore ${msg.id}: duplicate`);
    }
  }
}

registerHandlers(bot, { bridge, config, currentSessionManager, queue });

// Global error boundary: without bot.catch, any error thrown while handling an
// update (e.g. a command targeting a tmux session that doesn't exist) becomes an
// uncaughtException and kills the whole process. Catch it, tell the user, and
// keep running.
bot.catch((err) => {
  const reason = errMessage(err.error);
  console.error(`[bot] handler error: ${reason}`);
  void err.ctx.reply(`⚠️ ${reason}`).catch(() => {});
});

// Register bot commands once — Telegram persists them across restarts
try {
  await bot.api.setMyCommands(BOT_COMMANDS, { scope: { type: "all_private_chats" } });
  console.log(`[bot] Registered ${BOT_COMMANDS.length} commands to Telegram`);
} catch (err) {
  console.error("[bot] setMyCommands failed:", errMessage(err));
}

// Refuse to run a second live instance in the same runtime.
let shouldRun = true;
try {
  acquireInstanceLock();
} catch (err) {
  const message = err instanceof Error ? String(err.message) : String(err);
  const instanceLockMessage = err instanceof Error ? String(err.message) : String(err);
  if (err instanceof InstanceLockHeldError || /already running|instance lock/i.test(message)) {
    console.error(
      `[bot] ${instanceLockMessage}. Stop the existing instance before starting a new one.`,
    );
    process.exit(1);
    shouldRun = false;
  } else {
    throw err;
  }
}

if (shouldRun) {
  const recoveredFromCrash = detectUncleanRestart();
  if (recoveredFromCrash) {
    console.warn("[bot] Previous run did not exit cleanly.");
  }

  // Guard against duplicate signals calling stop() twice
  let stopping = false;

  const stop = async (
    signal: string,
    options: { keepQueuedMessages?: boolean; exitCode?: number } = {},
  ) => {
    if (stopping) return;
    stopping = true;

    console.log(`Stopping bot after ${signal}`);
    stopRateLimitCleanup();

    if (options.keepQueuedMessages) {
      queue.flushPending();
    } else {
      queue.clear();
      markCleanShutdown();
    }

    releaseInstanceLock();

    try {
      await bot.stop();
    } catch {
      // bot may already be stopped — ignore
    }

    process.exit(options.exitCode ?? 0);
  };

  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));

  // Catch-all: uncaught exceptions are fatal; log and terminate
  process.on("uncaughtException", (err) => {
    console.error(`[fatal] uncaughtException: ${errMessage(err)}`);
    void stop("uncaughtException", { keepQueuedMessages: true, exitCode: 1 });
  });

  process.on("unhandledRejection", (reason) => {
    console.error(`[fatal] unhandledRejection: ${errMessage(reason)}`);
    void stop("unhandledRejection", { keepQueuedMessages: true, exitCode: 1 });
  });

  console.log("[bot] Starting...");

  // Verify Telegram connectivity with exponential backoff
  const maxRetries = 5;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const me = await bot.api.getMe();
      console.log(`[bot] Connected to Telegram as @${me.username} (bot ID: ${me.id})`);
      break;
    } catch (err) {
      const delayMs = Math.min(1000 * 2 ** i, 30000);
      console.error(
        `[bot] Failed to connect (attempt ${i + 1}/${maxRetries}): ${errMessage(err)}. Retrying in ${delayMs}ms...`,
      );
      if (i === maxRetries - 1) {
        console.error("[bot] Max retries exceeded, exiting.");
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  await bot.start();
}
