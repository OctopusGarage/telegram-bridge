export type TmuxTarget = {
  session: string;
  window: number;
  pane: number;
};

export type AppConfig = {
  botToken: string;
  tmuxTarget: TmuxTarget;
  pollIntervalMs: number;
  maxMessageLength: number;
  idlePollTicks: number;
  maxPollTicks: number;
  proxyUrl?: string;
  allowedUserIds: Set<string>; // Telegram user IDs with access
  allowAllUsers: boolean; // when true, disables the allowlist (explicit opt-in)
  maxCommandLength: number;
  rateLimitMs: number;
  sessionRateLimitMs: number;
  globalRateLimitMs: number;
  maxConcurrentSessions: number;
  allowedRunPatterns: string[]; // Regex patterns a /run command must fully match (fail closed if empty)
  allowedCwdRoots: string[]; // Allowed directories for /cwd command (e.g. ["~/programming"])
  maxQueueSize: number;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
};

export type ExecFileLike = (file: string, args: string[]) => Promise<ExecResult>;

export type BotCommand = { command: string; description: string };
