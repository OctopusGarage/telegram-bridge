import { Bot } from "grammy";
import { loadConfig } from "./config.js";
import { registerHandlers, buildMiddleware, stopRateLimitCleanup, errMessage, BOT_COMMANDS } from "./bot/handlers.js";
import { TmuxBridge } from "./services/tmux.js";
import { CurrentSessionManager } from "./services/currentSession.js";

const config = loadConfig();
const bridge = new TmuxBridge({ target: config.tmuxTarget });
const currentSessionManager = new CurrentSessionManager(process.cwd());

const { HttpsProxyAgent } = await import("https-proxy-agent");

// Strip signal to avoid AbortSignal conflict between grammY internal signal and undici dispatcher
const bot = new Bot(config.botToken, {
  client: {
    fetch: config.proxyUrl
      ? (async (url: URL | RequestInfo, init?: RequestInit) => {
          const { signal: _signal, ...rest } = init || {};
          const agent = new HttpsProxyAgent(config.proxyUrl!);
          return fetch(url, { ...rest, dispatcher: agent } as RequestInit);
        })
      : undefined,
  },
});

// Apply user allowlist + rate limit middleware
bot.use(buildMiddleware(config));

// Graceful error handler — don't crash on network failures
bot.catch((err) => {
  console.error("[bot] Unhandled error:", errMessage(err));
});

registerHandlers(bot, { bridge, config, currentSessionManager });

// Register bot commands once — Telegram persists them across restarts
try {
  await bot.api.setMyCommands(BOT_COMMANDS, { scope: { type: "all_private_chats" } });
  console.log(`[bot] Registered ${BOT_COMMANDS.length} commands to Telegram`);
} catch (err) {
  console.error("[bot] setMyCommands failed:", errMessage(err));
}

// Guard against duplicate signals calling stop() twice
let stopping = false;
const stop = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`Stopping bot after ${signal}`);
  stopRateLimitCleanup();
  try {
    await bot.stop();
  } catch {
    // bot may already be stopped — ignore
  }
  process.exit(0);
};

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

// Catch-all: never let uncaught errors crash the process
process.on("uncaughtException", (err) => {
  console.error(`[fatal] uncaughtException: ${errMessage(err)}`);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[fatal] unhandledRejection: ${errMessage(reason)}`);
});

console.log("[bot] Starting...");
await bot.start();
console.log("[bot] Bot stopped gracefully");
process.exit(0);
