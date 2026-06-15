import { config as loadEnv } from "dotenv";
import { z } from "zod";
import type { AppConfig } from "./types.js";
import { expandTilde } from "./utils/path.js";

const envPath = process.env.TGB_ENV_FILE?.trim();
loadEnv(envPath ? { path: envPath } : {});

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  TMUX_SESSION: z.string().min(1).default("telegram_tmux_session"),
  TMUX_WINDOW: z.string().optional().default(""),
  TMUX_PANE: z.string().optional().default(""),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1200),
  MAX_MESSAGE_LENGTH: z.coerce.number().int().positive().default(3500),
  IDLE_POLL_TICKS: z.coerce.number().int().positive().default(3),
  MAX_POLL_TICKS: z.coerce.number().int().positive().default(20),
  HTTP_PROXY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  HTTPS_PROXY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  MAX_QUEUE_SIZE: z.coerce.number().int().positive().default(30),
  MAX_CONCURRENT_SESSIONS: z.coerce.number().int().positive().default(3),
  ALLOWED_USER_IDS: z.string().default(""),
  ALLOW_ALL_USERS: z.string().optional().default(""),
  MAX_COMMAND_LENGTH: z.coerce.number().int().positive().default(5000),
  RATE_LIMIT_MS: z.coerce.number().int().positive().default(2000),
  SESSION_RATE_LIMIT_MS: z.coerce.number().int().positive().default(1200),
  GLOBAL_RATE_LIMIT_MS: z.coerce.number().int().positive().default(500),
  ALLOWED_RUN_PATTERNS: z.string().default(""),
  ALLOWED_CWD_ROOTS: z.string().default(""),
});

const intOr = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    botToken: parsed.BOT_TOKEN,
    tmuxTarget: {
      session: parsed.TMUX_SESSION,
      window: intOr(parsed.TMUX_WINDOW, 0),
      pane: intOr(parsed.TMUX_PANE, 0),
    },
    pollIntervalMs: parsed.POLL_INTERVAL_MS,
    maxMessageLength: parsed.MAX_MESSAGE_LENGTH,
    idlePollTicks: parsed.IDLE_POLL_TICKS,
    maxPollTicks: parsed.MAX_POLL_TICKS,
    proxyUrl: parsed.HTTPS_PROXY ?? parsed.HTTP_PROXY,
    allowedUserIds: new Set(
      parsed.ALLOWED_USER_IDS.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    allowAllUsers: /^(1|true|yes)$/i.test(parsed.ALLOW_ALL_USERS.trim()),
    maxCommandLength: parsed.MAX_COMMAND_LENGTH,
    rateLimitMs: parsed.RATE_LIMIT_MS,
    sessionRateLimitMs: parsed.SESSION_RATE_LIMIT_MS,
    globalRateLimitMs: parsed.GLOBAL_RATE_LIMIT_MS,
    maxConcurrentSessions: parsed.MAX_CONCURRENT_SESSIONS,
    maxQueueSize: parsed.MAX_QUEUE_SIZE,
    allowedRunPatterns: parsed.ALLOWED_RUN_PATTERNS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    allowedCwdRoots: parsed.ALLOWED_CWD_ROOTS.split(",")
      .map((s) => s.trim())
      .map(expandTilde)
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index),
  };
}
