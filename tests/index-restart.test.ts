import { afterEach, describe, expect, it, vi } from "vitest";

type EventCallback = (...value: unknown[]) => void | Promise<void>;

function createEnv(overrides: {
  restoredMessages?: any[];
  uncleanRestart?: boolean;
  getMe?: () => Promise<{ id: number; username: string }>;
  acquireInstanceLock?: () => void;
} = {}) {
  let processExitCode = 0;
  const restoredMessages = overrides.restoredMessages ?? [];
  const BOT_COMMANDS = [{ command: "help", description: "Show all commands" }];
  const callbacks: Record<string, EventCallback> = {};
  const onceCallbacks: Record<string, EventCallback> = {};
  const getMe = overrides.getMe ?? vi.fn().mockResolvedValue({ id: 123, username: "testbot" });
  const acquireInstanceLock = overrides.acquireInstanceLock ?? (() => {});
  const InstanceLockHeldError = class extends Error {
    constructor() {
      super("instance lock held");
    }
  };

  const mockQueue = {
    setHandler: vi.fn(),
    loadPersisted: vi.fn(() => restoredMessages),
    clearPersisted: vi.fn(),
    enqueue: vi.fn(() => "queued"),
    flushPending: vi.fn(),
    clear: vi.fn(),
    size: vi.fn(),
    getSessionNames: vi.fn(),
    getSessionQueue: vi.fn(),
    getCurrentMessage: vi.fn(),
    isSessionProcessing: vi.fn(),
  };

  const markCleanShutdown = vi.fn();
  const releaseInstanceLock = vi.fn();
  const registerHandlers = vi.fn();
  const stopRateLimitCleanup = vi.fn();
  const detectUncleanRestart = vi.fn(() => overrides.uncleanRestart ?? false);

  const bot = {
    use: vi.fn(),
    api: {
      setMyCommands: vi.fn().mockResolvedValue(undefined),
      getMe,
    },
    stop: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    command: vi.fn(),
    on: vi.fn(),
  };

  vi.resetModules();
  vi.doMock("grammy", () => ({
    Bot: vi.fn(function () {
      return bot;
    }),
  }));
  vi.doMock("../src/config.js", () => ({
    loadConfig: vi.fn(() => ({
      botToken: "x",
      tmuxTarget: { session: "default", window: 0, pane: 0 },
      pollIntervalMs: 1200,
      maxMessageLength: 3500,
      idlePollTicks: 3,
      maxPollTicks: 20,
      proxyUrl: undefined,
      allowedUserIds: new Set<string>(),
      maxCommandLength: 5000,
      rateLimitMs: 2000,
      sessionRateLimitMs: 1000,
      globalRateLimitMs: 500,
      maxConcurrentSessions: 3,
      maxQueueSize: 30,
      claudeStartupCommand: "/startup",
      allowedCwdRoots: [],
    })),
  }));
  vi.doMock("../src/bot/handlers.js", () => ({
    BOT_COMMANDS,
    buildMiddleware: vi.fn(() => (ctx: unknown, next: () => Promise<void>) => next()),
    registerHandlers,
    executeQueuedCommand: vi.fn(),
    stopRateLimitCleanup,
    errMessage: vi.fn((value: unknown) => String(value)),
  }));
  vi.doMock("../src/core/queue.js", () => ({
    MessageQueue: vi.fn(function () {
      return mockQueue;
    }),
  }));
  vi.doMock("../src/core/lifecycle.js", () => ({
    detectUncleanRestart,
    markCleanShutdown,
  }));
  vi.doMock("../src/core/instance-lock.js", () => ({
    acquireInstanceLock: vi.fn(acquireInstanceLock),
    releaseInstanceLock,
    InstanceLockHeldError,
  }));
  vi.doMock("../src/services/tmux.js", () => ({
    TmuxBridge: vi.fn(function () {
      return {};
    }),
  }));
  vi.doMock("../src/services/currentSession.js", () => ({
    CurrentSessionManager: vi.fn(function () {
      return {};
    }),
  }));

  const processExit = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    processExitCode = code === undefined ? 0 : Number(code);
    return undefined as never;
  });

  vi.spyOn(process, "once").mockImplementation((event, listener) => {
    onceCallbacks[event as string] = listener as EventCallback;
    return process;
  });
  vi.spyOn(process, "on").mockImplementation((event, listener) => {
    callbacks[event as string] = listener as EventCallback;
    return process;
  });

  return {
    BOT_COMMANDS,
    InstanceLockHeldError,
    mockQueue,
    bot,
    registerHandlers,
    markCleanShutdown,
    stopRateLimitCleanup,
    releaseInstanceLock,
    detectUncleanRestart,
    onceCallbacks,
    callbacks,
    getExitCode: () => processExitCode,
    processExit,
  };
}

describe("index bootstrap and shutdown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores persisted queued messages during startup", async () => {
    const restored = [{ id: "old-1", text: "ls", chatId: 1, sessionName: "default", action: "command" }];
    const env = createEnv({ restoredMessages: restored });

    await import("../src/index.js");

    expect(env.mockQueue.loadPersisted).toHaveBeenCalled();
    expect(env.mockQueue.clearPersisted).toHaveBeenCalled();
    expect(env.mockQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "old-1",
        text: "ls",
        chatId: 1,
        sessionName: "default",
        action: "command",
      }),
    );
    expect(env.bot.api.setMyCommands).toHaveBeenCalledWith(
      env.BOT_COMMANDS,
      { scope: { type: "all_private_chats" } },
    );
  });

  it("SIGTERM clears in-memory queue and marks clean shutdown", async () => {
    const env = createEnv();
    await import("../src/index.js");

    await env.onceCallbacks.SIGTERM?.();
    await Promise.resolve();

    expect(env.mockQueue.clear).toHaveBeenCalled();
    expect(env.mockQueue.flushPending).not.toHaveBeenCalled();
    expect(env.markCleanShutdown).toHaveBeenCalled();
    expect(env.releaseInstanceLock).toHaveBeenCalled();
    expect(env.getExitCode()).toBe(0);
  });

  it("uncaughtException keeps pending queue by flushing pending file", async () => {
    const env = createEnv();
    await import("../src/index.js");

    await env.callbacks.uncaughtException?.(new Error("boom"));
    await Promise.resolve();

    expect(env.mockQueue.flushPending).toHaveBeenCalled();
    expect(env.mockQueue.clear).not.toHaveBeenCalled();
    expect(env.markCleanShutdown).not.toHaveBeenCalled();
    expect(env.getExitCode()).toBe(1);
  });

  it("retries getMe once and then starts after transient failure", async () => {
    const getMe = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary network issue"))
      .mockResolvedValue({ id: 123, username: "testbot" });

    const env = createEnv({ getMe });

    const importPromise = import("../src/index.js");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await importPromise;

    expect(getMe).toHaveBeenCalledTimes(2);
    expect(env.bot.api.setMyCommands).toHaveBeenCalledWith(
      env.BOT_COMMANDS,
      { scope: { type: "all_private_chats" } },
    );
    expect(env.getExitCode()).toBe(0);
  });

  it("logs unclean restart warning when startup is not clean", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = createEnv({ uncleanRestart: true });

    await import("../src/index.js");

    expect(warn).toHaveBeenCalledWith("[bot] Previous run did not exit cleanly.");
    expect(env.markCleanShutdown).not.toHaveBeenCalled();
    expect(env.getExitCode()).toBe(0);
    warn.mockRestore();
  });

  it("propagates unexpected instance lock error", async () => {
    const lockError = new Error("lock failure");
    const env = createEnv({ acquireInstanceLock: () => { throw lockError; } });

    await expect(import("../src/index.js")).rejects.toThrow("lock failure");
    expect(env.getExitCode()).toBe(0);
  });

  it("exits when instance lock is already held", async () => {
    const env = createEnv({
      acquireInstanceLock: () => {
        throw new env.InstanceLockHeldError();
      },
    });

    await expect(import("../src/index.js")).resolves.toBeDefined();
    expect(env.bot.api.getMe).not.toHaveBeenCalled();
    expect(env.getExitCode()).toBe(1);
  });
});
