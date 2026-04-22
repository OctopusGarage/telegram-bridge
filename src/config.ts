import { config as loadEnv } from "dotenv";
import { z } from "zod";
import type { AppConfig } from "./types.js";

loadEnv();

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  TMUX_SESSION: z.string().min(1),
  TMUX_WINDOW: z.string().optional().default(""),
  TMUX_PANE: z.string().optional().default(""),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1200),
  MAX_MESSAGE_LENGTH: z.coerce.number().int().positive().default(3500),
  IDLE_POLL_TICKS: z.coerce.number().int().positive().default(3),
  MAX_POLL_TICKS: z.coerce.number().int().positive().default(20),
  HTTP_PROXY: z.string().url().optional(),
  HTTPS_PROXY: z.string().url().optional(),
  ALLOWED_USER_IDS: z.string().default(""),
  MAX_COMMAND_LENGTH: z.coerce.number().int().positive().default(5000),
  RATE_LIMIT_MS: z.coerce.number().int().positive().default(2000),
  CLAUDE_STARTUP_COMMAND: z.string().min(1),
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
      parsed.ALLOWED_USER_IDS
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
    maxCommandLength: parsed.MAX_COMMAND_LENGTH,
    rateLimitMs: parsed.RATE_LIMIT_MS,
    claudeStartupCommand: parsed.CLAUDE_STARTUP_COMMAND,
    allowedCwdRoots: parsed.ALLOWED_CWD_ROOTS
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
