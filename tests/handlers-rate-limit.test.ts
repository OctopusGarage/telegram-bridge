import { describe, expect, it, vi } from "vitest";

type CommandHandler = (ctx: any) => Promise<void> | void;

function makeConfig(overrides: Partial<Record<string, any>> = {}) {
  return {
    botToken: "x",
    tmuxTarget: { session: "default", window: 0, pane: 0 },
    pollIntervalMs: 1200,
    maxMessageLength: 3500,
    idlePollTicks: 3,
    maxPollTicks: 20,
    proxyUrl: undefined,
    allowedUserIds: new Set<string>(),
    allowAllUsers: false,
    maxCommandLength: 5000,
    rateLimitMs: 2000,
    sessionRateLimitMs: 1000,
    globalRateLimitMs: 500,
    maxConcurrentSessions: 3,
    maxQueueSize: 10,
    allowedRunPatterns: ["claude(-[a-z]+)?"],
    allowedCwdRoots: [],
    ...overrides,
  };
}

function buildBot() {
  const handlers: Record<string, CommandHandler> = {};
  const bot = {
    command: (name: string, cb: CommandHandler) => {
      handlers[name] = cb;
    },
    on: () => {},
    use: vi.fn(),
  };
  return { bot, handlers };
}

function makeQueuedMessage(overrides: Partial<any> = {}) {
  return {
    id: `q-${Math.random()}`,
    text: "text",
    chatId: 100,
    sessionName: "default",
    action: "command",
    resolve: vi.fn(),
    reject: vi.fn(),
    ...overrides,
  };
}

describe("handlers rate limiting", () => {
  it("rejects repeated session commands inside sessionRateLimitMs", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const queue = {
      size: vi.fn().mockReturnValue(0),
      enqueue: vi.fn().mockReturnValue("queued"),
      getSessionNames: vi.fn().mockReturnValue([]),
      getSessionQueue: vi.fn().mockReturnValue([]),
      getCurrentMessage: vi.fn(),
      isSessionProcessing: vi.fn().mockReturnValue(false),
    };

    const deps = {
      bridge: {
        sessionExists: vi.fn().mockResolvedValue(true),
      },
      config: makeConfig({ sessionRateLimitMs: 1000, globalRateLimitMs: 500 }),
      currentSessionManager: { get: vi.fn(), set: vi.fn() },
      queue,
    };

    const { bot, handlers } = buildBot();
    registerHandlers(bot as any, deps as any);
    const runHandler = handlers.run;
    expect(runHandler).toBeDefined();

    const now = vi.spyOn(Date, "now");
    let nowSeed = 1_000;
    now.mockImplementation(() => {
      const value = nowSeed;
      nowSeed += 100;
      return value;
    });

    const reply1 = vi.fn();
    const reply2 = vi.fn();
    await runHandler!({
      message: { text: "/run claude-test" },
      match: null,
      from: { id: "42" },
      chat: { id: 42 },
      reply: reply1,
    } as any);
    await runHandler!({
      message: { text: "/run claude-quick" },
      match: null,
      from: { id: "42" },
      chat: { id: 42 },
      reply: reply2,
    } as any);

    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(reply2).toHaveBeenCalledWith(expect.stringContaining("Session is busy"), undefined);

    now.mockRestore();
  });

  it("blocks quick cross-session messages with global rate limit", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const queue = {
      size: vi.fn().mockReturnValue(0),
      enqueue: vi.fn().mockReturnValue("queued"),
      getSessionNames: vi.fn().mockReturnValue([]),
      getSessionQueue: vi.fn().mockReturnValue([]),
      getCurrentMessage: vi.fn(),
      isSessionProcessing: vi.fn().mockReturnValue(false),
    };

    const deps = {
      bridge: {
        sessionExists: vi.fn().mockResolvedValue(true),
      },
      config: makeConfig({ sessionRateLimitMs: 0, globalRateLimitMs: 1_000 }),
      currentSessionManager: { get: vi.fn().mockResolvedValue(null), set: vi.fn() },
      queue,
    };

    const { bot, handlers } = buildBot();
    registerHandlers(bot as any, deps as any);
    const runHandler = handlers.run;
    expect(runHandler).toBeDefined();

    const now = vi.spyOn(Date, "now");
    let nowSeed = 1_000;
    now.mockImplementation(() => {
      const value = nowSeed;
      nowSeed += 100;
      return value;
    });

    const reply1 = vi.fn();
    const reply2 = vi.fn();
    await runHandler!({
      message: { text: "/run claude-first" },
      match: null,
      from: { id: "99" },
      chat: { id: 99 },
      reply: reply1,
    } as any);
    await runHandler!({
      message: { text: "/run claude-second" },
      match: null,
      from: { id: "99" },
      chat: { id: 99 },
      reply: reply2,
    } as any);

    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(reply2).toHaveBeenCalledWith(
      "Queue is temporarily throttled. Please wait a moment.",
      undefined,
    );
    now.mockRestore();
  });

  it("shows queue_status session queue and current execution state", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const queue = {
      size: vi.fn().mockReturnValue(3),
      getSessionNames: vi.fn().mockReturnValue(["default"]),
      getSessionQueue: vi
        .fn()
        .mockReturnValue([makeQueuedMessage({ id: "q1", text: "second in line" })]),
      getCurrentMessage: vi
        .fn()
        .mockReturnValue(
          makeQueuedMessage({ id: "running", text: "first in line", action: "command" }),
        ),
      isSessionProcessing: vi.fn().mockReturnValue(true),
    };

    const deps = {
      bridge: {},
      config: makeConfig({ maxConcurrentSessions: 2 }),
      currentSessionManager: {},
      queue,
    };

    const reply = vi.fn();
    const { bot, handlers } = buildBot();
    registerHandlers(bot as any, deps as any);
    await handlers.queue_status({
      reply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    const text = reply.mock.calls[0]?.[0] as string;
    expect(text).toContain("running");
    expect(text).toContain("queued: 1");
    expect(text).toContain("first in line");
  });
});

describe("buildMiddleware", () => {
  it("denies users not in allowlist", async () => {
    vi.resetModules();
    const { buildMiddleware } = await import("../src/bot/handlers.js");

    const middleware = buildMiddleware({
      ...makeConfig(),
      allowedUserIds: new Set(["42"]),
    });
    const next = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn();

    await middleware({ from: { id: "99" }, reply } as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith("Access denied.", undefined);
  });

  it("allows allowlisted users", async () => {
    vi.resetModules();
    const { buildMiddleware } = await import("../src/bot/handlers.js");
    const userId = `u-${Date.now()}-a`;

    const middleware = buildMiddleware({
      ...makeConfig(),
      allowedUserIds: new Set([userId]),
      rateLimitMs: 2_000,
    });
    const next = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn();
    const now = vi.spyOn(Date, "now");
    let nowSeed = 1_700_000_000_000;
    now.mockImplementation(() => {
      const value = nowSeed;
      nowSeed += 100;
      return value;
    });

    await middleware({ from: { id: userId }, reply } as any, next);
    await middleware({ from: { id: userId }, reply } as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("Too fast. Please wait a moment.", undefined);

    now.mockRestore();
  });

  it("isolates rate limit per user", async () => {
    vi.resetModules();
    const { buildMiddleware } = await import("../src/bot/handlers.js");
    const userA = `u-${Date.now()}-a`;
    const userB = `u-${Date.now()}-b`;

    const middleware = buildMiddleware({
      ...makeConfig(),
      allowedUserIds: new Set([userA, userB]),
      rateLimitMs: 2_000,
    });
    const next = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn();

    const now = vi.spyOn(Date, "now");
    let nowSeed = 1_700_000_000_000;
    now.mockImplementation(() => {
      const value = nowSeed;
      nowSeed += 1_500;
      return value;
    });

    await middleware({ from: { id: userA }, reply } as any, next);
    await middleware({ from: { id: userB }, reply } as any, next);

    expect(next).toHaveBeenCalledTimes(2);

    now.mockRestore();
  });
});
