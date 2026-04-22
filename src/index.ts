import { Bot } from "grammy";
import { loadConfig } from "./config.js";
import { registerHandlers, buildMiddleware, stopRateLimitCleanup, errMessage, BOT_COMMANDS } from "./bot/handlers.js";
import { TmuxBridge } from "./services/tmux.js";
import { CurrentSessionManager } from "./services/currentSession.js";

const config = loadConfig();
const bridge = new TmuxBridge({ target: config.tmuxTarget });
const currentSessionManager = new CurrentSessionManager(process.cwd());

// Retry config
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 60000;
const MAX_RETRIES = 10;
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ENETUNREACH",
  "EAI_AGAIN", "ECONNREFUSED", "EPIPE"
]);

function isTransientError(cause: unknown): boolean {
  if (cause instanceof Error) {
    if ("code" in cause && typeof (cause as { code: string }).code === "string") {
      return TRANSIENT_ERROR_CODES.has((cause as { code: string }).code);
    }
    const msg = cause.message.toLowerCase();
    return msg.includes("timeout") || msg.includes("econnreset") ||
           msg.includes("network") || msg.includes("fetch");
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Proxy-aware fetch with proxy-first, fallback-to-direct, and retry logic
async function createResilientFetch(proxyUrl?: string) {
  // Determine if proxy is available
  let useProxy = Boolean(proxyUrl);

  async function fetchWithRetry(
    input: RequestInfo | URL,
    init?: RequestInit,
    retryCount = 0
  ): Promise<Response> {
    const urlStr = input instanceof URL ? input.toString() : String(input);
    const isTelegramApi = urlStr.startsWith("https://api.telegram.org");

    if (!isTelegramApi) {
      // Not Telegram — use native fetch, no proxy, no retry
      return fetch(input, init);
    }

    let fetchImpl: typeof fetch;

    if (useProxy) {
      try {
        const { HttpsProxyAgent } = await import("https-proxy-agent");
        const agent = new HttpsProxyAgent(proxyUrl!);
        fetchImpl = (url, opts) => fetch(url, { ...opts, dispatcher: agent } as RequestInit);
      } catch {
        console.warn("[network] Failed to load https-proxy-agent, falling back to direct");
        useProxy = false;
        fetchImpl = fetch;
      }
    } else {
      fetchImpl = fetch;
    }

    try {
      const resp = await fetchImpl(input, init);

      // Telegram rate limit — retry with backoff
      if (resp.status === 429) {
        const retryAfter = Number(resp.headers.get("Retry-After")) * 1000 || 5000;
        const delay = Math.min(retryAfter, MAX_RETRY_DELAY_MS);
        console.warn(`[network] Rate limited, retrying in ${delay}ms`);
        await sleep(delay);
        return fetchWithRetry(input, init, retryCount);
      }

      return resp;
    } catch (err) {
      if (!isTransientError(err)) throw err;

      if (retryCount >= MAX_RETRIES) {
        console.error(`[network] Max retries (${MAX_RETRIES}) exceeded, giving up`);
        throw err;
      }

      // Exponential backoff with jitter
      const delay = Math.min(INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount), MAX_RETRY_DELAY_MS);
      const jitter = Math.random() * 500;
      const wait = delay + jitter;
      console.warn(`[network] Transient error (attempt ${retryCount + 1}/${MAX_RETRIES}), retrying in ${Math.round(wait)}ms: ${(err as Error).message}`);
      await sleep(wait);

      return fetchWithRetry(input, init, retryCount + 1);
    }
  }

  return fetchWithRetry;
}

const { HttpsProxyAgent } = await import("https-proxy-agent");
const proxyAgent = new HttpsProxyAgent(config.proxyUrl);

// Strip signal to avoid AbortSignal conflict between gramjs internal signal and undici dispatcher
const bot = new Bot(config.botToken, {
  client: {
    fetch: (url, init) => {
      const { signal: _signal, ...rest } = init || {};
      return fetch(url, { ...rest, dispatcher: proxyAgent } as RequestInit);
    },
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
