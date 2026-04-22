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
  allowedUserIds: Set<string>;  // Telegram user IDs with access
  maxCommandLength: number;
  rateLimitMs: number;
  claudeStartupCommand: string;
  allowedCwdRoots: string[];  // Allowed directories for /cwd command (e.g. ["~/programming"])
};

export type ExecResult = {
  stdout: string;
  stderr: string;
};

export type ExecFileLike = (file: string, args: string[]) => Promise<ExecResult>;

export type BotCommand = { command: string; description: string };
