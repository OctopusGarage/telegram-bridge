import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sessionShortId } from "../src/utils/hash.js";
import { appStateFile } from "../src/core/state-dir.js";

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
    maxCommandLength: 5000,
    rateLimitMs: 2000,
    sessionRateLimitMs: 1000,
    globalRateLimitMs: 500,
    maxConcurrentSessions: 3,
    maxQueueSize: 10,
    claudeStartupCommand: "/startup",
    allowedCwdRoots: [],
    ...overrides,
  };
}

function makeTempDir(prefix: string): string {
  const candidate = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(candidate, { recursive: true });
  return candidate;
}

function buildBot() {
  const commands: Record<string, CommandHandler> = {};
  const messageHandlers: Record<string, CommandHandler> = {};
  const bot = {
    command: (name: string, cb: CommandHandler) => {
      commands[name] = cb;
    },
    on: (event: string, cb: CommandHandler) => {
      messageHandlers[event] = cb;
    },
    use: vi.fn(),
  };
  return { bot, commands, messageHandlers };
}

describe("registerHandlers", () => {
  it("/sessions sends formatted session list", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const hash = sessionShortId("dev");
    const deps = {
      bridge: {
        listSessionNames: vi.fn().mockResolvedValue(["work", "dev"]),
      },
      config: makeConfig(),
      currentSessionManager: {
        get: vi.fn().mockResolvedValue("dev"),
      },
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.sessions({
      reply,
      chat: { id: 1 },
    } as any);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("🖥️ tmux sessions:"), undefined);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("/attach_"), undefined);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining(hash), undefined);
  });

  it("/sessions reports fetch failure", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const deps = {
      bridge: {
        listSessionNames: vi.fn().mockRejectedValue(new Error("tmux unreachable")),
      },
      config: makeConfig(),
      currentSessionManager: { get: vi.fn().mockResolvedValue(null) },
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.sessions({
      reply,
      chat: { id: 1 },
    } as any);

    expect(reply).toHaveBeenCalledWith("Failed: tmux unreachable", undefined);
  });

  it("/run accepts explicit session name argument", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");
    const queue = {
      size: vi.fn().mockReturnValue(0),
      enqueue: vi.fn().mockReturnValue("queued"),
      getSessionNames: vi.fn().mockReturnValue([]),
      getSessionQueue: vi.fn().mockReturnValue([]),
      getCurrentMessage: vi.fn(),
      isSessionProcessing: vi.fn().mockReturnValue(false),
    } as any;

    const deps = {
      bridge: { sessionExists: vi.fn().mockResolvedValue(true) },
      config: makeConfig({
        tmuxTarget: { session: "default", window: 0, pane: 0 },
      }),
      currentSessionManager: { get: vi.fn().mockResolvedValue("other"), set: vi.fn() },
      queue,
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.run({
      message: { text: "/run default claude-foo" },
      match: "default claude-foo",
      reply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ sessionName: "default", text: "claude-foo" }),
    );
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("✅ Sent to default"), undefined);
  });

  it("/attach accepts short hash and switches by hash", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const targetHash = sessionShortId("dev");
    const deps = {
      bridge: {
        listSessionNames: vi.fn().mockResolvedValue(["work", "dev"]),
      },
      config: makeConfig(),
      currentSessionManager: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
      },
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.attach({
      match: targetHash,
      reply,
      chat: { id: 2 },
      from: { id: 2 },
    } as any);

    expect(deps.currentSessionManager.set).toHaveBeenCalledWith("dev");
    expect(reply).toHaveBeenCalledWith("✅ Switched to dev", undefined);
  });

  it("/attach rejects invalid session id", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const deps = {
      bridge: { listSessionNames: vi.fn().mockResolvedValue(["work", "dev"]) },
      config: makeConfig(),
      currentSessionManager: { get: vi.fn().mockResolvedValue(null), set: vi.fn() },
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.attach({
      match: "abc",
      reply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    expect(reply).toHaveBeenCalledWith("Invalid session id. Use /sessions to see available hashes.", undefined);
  });

  it("/attach legacy numeric index honors current session ordering", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const setSession = vi.fn();
    const deps = {
      bridge: {
        listSessionNames: vi.fn().mockResolvedValue(["a", "b", "c", "d"]),
      },
      config: makeConfig(),
      currentSessionManager: {
        get: vi.fn().mockResolvedValue("c"),
        set: setSession,
      },
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.attach({
      match: "4",
      reply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    expect(setSession).toHaveBeenCalledWith("d");
    expect(reply).toHaveBeenCalledWith("✅ Switched to d", undefined);
  });

  it("/remove accepts legacy numeric index and removes target", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const deps = {
      bridge: {
        listSessionNames: vi.fn().mockResolvedValue(["work", "dev"]),
        killSession: vi.fn().mockResolvedValue(undefined),
      },
      config: makeConfig(),
      currentSessionManager: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
      },
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.remove({
      match: "2",
      reply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    expect(deps.bridge.killSession).toHaveBeenCalledWith("dev");
    expect(reply).toHaveBeenCalledWith("✅ Removed session dev", undefined);
  });

  it("/remove legacy numeric index honors current session ordering", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const deps = {
      bridge: {
        listSessionNames: vi.fn().mockResolvedValue(["a", "b", "c", "d"]),
        killSession: vi.fn().mockResolvedValue(undefined),
      },
      config: makeConfig(),
      currentSessionManager: {
        get: vi.fn().mockResolvedValue("c"),
        set: vi.fn(),
      },
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.remove({
      match: "4",
      reply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    expect(deps.bridge.killSession).toHaveBeenCalledWith("d");
    expect(reply).toHaveBeenCalledWith("✅ Removed session d", undefined);
  });

  it("handles message text shortcuts /attach_<hash> and /remove_<hash>", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const targetHash = sessionShortId("dev");
    const deps = {
      bridge: {
        listSessionNames: vi.fn().mockResolvedValue(["work", "dev"]),
        killSession: vi.fn().mockResolvedValue(undefined),
      },
      config: makeConfig(),
      currentSessionManager: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
      },
    } as any;

    const { bot, commands, messageHandlers } = buildBot();
    registerHandlers(bot as any, deps);

    const textReply = vi.fn();
    await messageHandlers["message:text"]({
      message: { text: `/attach_${targetHash}` },
      match: `/attach_${targetHash}`,
      reply: textReply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    expect(deps.currentSessionManager.set).toHaveBeenCalledWith("dev");
    expect(textReply).toHaveBeenCalledWith("✅ Switched to dev", undefined);

    await messageHandlers["message:text"]({
      message: { text: `/remove_${targetHash}` },
      match: `/remove_${targetHash}`,
      reply: vi.fn(),
      chat: { id: 1 },
      from: { id: 1 },
    } as any);
    expect(deps.bridge.killSession).toHaveBeenCalledWith("dev");
  });

  it("handles numeric shortcut /attach_<n> and /remove_<n> with current-session ordering", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const deps = {
      bridge: {
        listSessionNames: vi.fn().mockResolvedValue(["a", "b", "c", "d"]),
        killSession: vi.fn().mockResolvedValue(undefined),
      },
      config: makeConfig(),
      currentSessionManager: {
        get: vi.fn().mockResolvedValue("c"),
        set: vi.fn(),
      },
    } as any;

    const { bot, messageHandlers } = buildBot();
    registerHandlers(bot as any, deps);

    const attachReply = vi.fn();
    await messageHandlers["message:text"]({
      message: { text: "/attach_2" },
      match: "/attach_2",
      reply: attachReply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);
    expect(deps.currentSessionManager.set).toHaveBeenCalledWith("a");
    expect(attachReply).toHaveBeenCalledWith("✅ Switched to a", undefined);

    const removeReply = vi.fn();
    await messageHandlers["message:text"]({
      message: { text: "/remove_2" },
      match: "/remove_2",
      reply: removeReply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);
    expect(deps.bridge.killSession).toHaveBeenCalledWith("a");
    expect(removeReply).toHaveBeenCalledWith("✅ Removed session a", undefined);
  });

  it("/list_recent_workdir reports no entries when file is absent", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");
    const originalStateDir = process.env.TGB_STATE_DIR;
    const testStateDir = makeTempDir("state-dir-list-empty");
    process.env.TGB_STATE_DIR = testStateDir;
    const recentPath = appStateFile("recent_workdir.txt");
    const restore = fs.existsSync(recentPath);
    const original = restore ? fs.readFileSync(recentPath, "utf-8") : "";
    try {
      fs.rmSync(recentPath);
      const deps = {
        bridge: { sessionExists: vi.fn().mockResolvedValue(true) },
        config: makeConfig(),
        currentSessionManager: { get: vi.fn().mockResolvedValue("default"), set: vi.fn() },
        queue: {
          size: vi.fn(),
          enqueue: vi.fn(),
          getSessionNames: vi.fn(),
          getSessionQueue: vi.fn(),
          getCurrentMessage: vi.fn(),
          isSessionProcessing: vi.fn(),
        },
      } as any;

      const { bot, commands } = buildBot();
      registerHandlers(bot as any, deps);

      const reply = vi.fn();
      await commands.list_recent_workdir({
        reply,
        chat: { id: 1 },
        from: { id: 1 },
      } as any);

      expect(reply).toHaveBeenCalledWith("No recent directories.", undefined);
    } catch {
      // ignore remove errors
    } finally {
      if (originalStateDir === undefined) {
        delete process.env.TGB_STATE_DIR;
      } else {
        process.env.TGB_STATE_DIR = originalStateDir;
      }
      if (restore) {
        fs.writeFileSync(recentPath, original, "utf-8");
      }
    }
  });

  it("/list_recent_workdir enumerates recorded paths", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");
    const originalStateDir = process.env.TGB_STATE_DIR;
    const testStateDir = makeTempDir("state-dir-list-filled");
    process.env.TGB_STATE_DIR = testStateDir;
    const recentPath = appStateFile("recent_workdir.txt");
    const restore = fs.existsSync(recentPath);
    const original = restore ? fs.readFileSync(recentPath, "utf-8") : "";
    const workDir = makeTempDir("tmp-work");
    const notesDir = makeTempDir("tmp-notes");
    fs.writeFileSync(recentPath, `${workDir}\n${notesDir}\n`, "utf-8");

    try {
      const deps = {
        bridge: { sessionExists: vi.fn().mockResolvedValue(true) },
        config: makeConfig(),
        currentSessionManager: { get: vi.fn().mockResolvedValue("default"), set: vi.fn() },
        queue: {
          size: vi.fn(),
          enqueue: vi.fn(),
          getSessionNames: vi.fn(),
          getSessionQueue: vi.fn(),
          getCurrentMessage: vi.fn(),
          isSessionProcessing: vi.fn(),
        },
      } as any;

      const { bot, commands } = buildBot();
      registerHandlers(bot as any, deps);

      const reply = vi.fn();
      await commands.list_recent_workdir({
        reply,
        chat: { id: 1 },
        from: { id: 1 },
      } as any);
      const output = reply.mock.calls[0]![0];

      expect(output).toContain("📁 Recent directories:");
      expect(output).toContain("/cwd_1");
      expect(output).toContain("/cwd_2");
      expect(output).toMatch(/1\.\s+\/.*tmp-work/);
      expect(output).toMatch(/2\.\s+\/.*tmp-notes/);
      expect(reply).toHaveBeenCalledWith(output, undefined);
      expect(fs.readFileSync(recentPath, "utf-8")).toContain("tmp-work");
      expect(fs.readFileSync(recentPath, "utf-8")).toContain("tmp-notes");
    } finally {
      if (originalStateDir === undefined) {
        delete process.env.TGB_STATE_DIR;
      } else {
        process.env.TGB_STATE_DIR = originalStateDir;
      }
      if (restore) {
        fs.writeFileSync(recentPath, original, "utf-8");
      } else {
        fs.rmSync(recentPath, { force: true });
      }
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.rmSync(notesDir, { recursive: true, force: true });
    }
  });

  it("/list_recent_workdir filters invalid and non-whitelisted paths", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");
    const originalStateDir = process.env.TGB_STATE_DIR;
    const testStateDir = makeTempDir("state-dir-list-filter");
    process.env.TGB_STATE_DIR = testStateDir;
    const recentPath = appStateFile("recent_workdir.txt");
    const restore = fs.existsSync(recentPath);
    const original = restore ? fs.readFileSync(recentPath, "utf-8") : "";
    const fixtureRoot = makeTempDir("tmp-workdir-filter");
    const keepDir = path.join(fixtureRoot, "keep");
    fs.mkdirSync(keepDir);
    const keepDirReal = fs.realpathSync(keepDir);

    fs.writeFileSync(
      recentPath,
      `${keepDir}\n${fixtureRoot}/not-exist\n/tmp/a\n/tmp/b\n${keepDir}\n`,
      "utf-8",
    );

    try {
      const deps = {
        bridge: { sessionExists: vi.fn().mockResolvedValue(true) },
        config: makeConfig({ allowedCwdRoots: [fixtureRoot] }),
        currentSessionManager: { get: vi.fn().mockResolvedValue("default"), set: vi.fn() },
        queue: {
          size: vi.fn(),
          enqueue: vi.fn(),
          getSessionNames: vi.fn(),
          getSessionQueue: vi.fn(),
          getCurrentMessage: vi.fn(),
          isSessionProcessing: vi.fn(),
        },
      } as any;

      const { bot, commands } = buildBot();
      registerHandlers(bot as any, deps);

      const reply = vi.fn();
      await commands.list_recent_workdir({
        reply,
        chat: { id: 1 },
        from: { id: 1 },
      } as any);

      expect(reply).toHaveBeenCalledWith(
        `📁 Recent directories:\n\n1. ${keepDirReal}\n/cwd_1`,
        undefined,
      );
      expect(fs.readFileSync(recentPath, "utf-8")).toBe(`${keepDirReal}\n`);
    } finally {
      if (originalStateDir === undefined) {
        delete process.env.TGB_STATE_DIR;
      } else {
        process.env.TGB_STATE_DIR = originalStateDir;
      }
      if (restore) {
        fs.writeFileSync(recentPath, original, "utf-8");
      } else {
        fs.rmSync(recentPath, { force: true });
      }
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("switches to a recent directory with /cwd_ index and rejects out-of-range index", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");
    const originalStateDir = process.env.TGB_STATE_DIR;
    const testStateDir = makeTempDir("state-dir-recent-switch");
    process.env.TGB_STATE_DIR = testStateDir;
    const recentPath = appStateFile("recent_workdir.txt");
    const restore = fs.existsSync(recentPath);
    const original = restore ? fs.readFileSync(recentPath, "utf-8") : "";
    const fixtureRoot = makeTempDir("tmp-cwd-recent");
    const dirARaw = path.join(fixtureRoot, "a");
    const dirBRaw = path.join(fixtureRoot, "b");
    fs.mkdirSync(dirARaw);
    fs.mkdirSync(dirBRaw);
    const dirA = fs.realpathSync(dirARaw);
    const dirB = fs.realpathSync(dirBRaw);
    fs.writeFileSync(recentPath, `${dirA}\n${dirB}\n`, "utf-8");

    const deps = {
      bridge: {
        ensurePaneExists: vi.fn().mockResolvedValue(undefined),
        sendCommand: vi.fn().mockResolvedValue(undefined),
      },
      config: makeConfig({ allowedCwdRoots: [fixtureRoot] }),
      currentSessionManager: { get: vi.fn().mockResolvedValue("default"), set: vi.fn() },
      queue: {
        size: vi.fn(),
        enqueue: vi.fn(),
        getSessionNames: vi.fn(),
        getSessionQueue: vi.fn(),
        getCurrentMessage: vi.fn(),
        isSessionProcessing: vi.fn(),
      },
    } as any;

    try {
      const { bot, messageHandlers } = buildBot();
      registerHandlers(bot as any, deps);
      const textReply = vi.fn();
      const outRangeReply = vi.fn();

      await messageHandlers["message:text"]({
        message: { text: "/cwd_2" },
        match: "/cwd_2",
        reply: textReply,
        chat: { id: 1 },
        from: { id: 1 },
      } as any);
      expect(deps.bridge.sendCommand).toHaveBeenCalledWith(`cd ${JSON.stringify(dirB)} && pwd`);
      expect(textReply).toHaveBeenCalledWith(`✅ cd to ${dirB}`, undefined);

      await messageHandlers["message:text"]({
        message: { text: "/cwd_3" },
        match: "/cwd_3",
        reply: outRangeReply,
        chat: { id: 1 },
        from: { id: 1 },
      } as any);
      expect(outRangeReply).toHaveBeenCalledWith("Index out of range (1–2).", undefined);
    } finally {
      if (originalStateDir === undefined) {
        delete process.env.TGB_STATE_DIR;
      } else {
        process.env.TGB_STATE_DIR = originalStateDir;
      }
      if (restore) {
        fs.writeFileSync(recentPath, original, "utf-8");
      } else {
        fs.rmSync(recentPath, { force: true });
      }
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("/peek captures current pane and replies", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const deps = {
      bridge: {
        ensurePaneExists: vi.fn().mockResolvedValue(undefined),
        capturePane: vi.fn().mockResolvedValue("pane content"),
        sessionExists: vi.fn().mockResolvedValue(true),
      },
      config: makeConfig(),
      currentSessionManager: { get: vi.fn().mockResolvedValue("default") },
      queue: { size: vi.fn(), enqueue: vi.fn(), getSessionNames: vi.fn(), getSessionQueue: vi.fn(), getCurrentMessage: vi.fn(), isSessionProcessing: vi.fn() },
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.peek({
      match: "",
      reply,
      chat: { id: 3 },
      from: { id: 3 },
    } as any);

    expect(deps.bridge.ensurePaneExists).toHaveBeenCalledWith();
    expect(deps.bridge.capturePane).toHaveBeenCalledWith();
    expect(reply).toHaveBeenCalledWith("📺 default:\n<pre>pane content</pre>", { parse_mode: "HTML" });
  });

  it("/peek surfaces error message when bridge fails", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");

    const deps = {
      bridge: {
        ensurePaneExists: vi.fn().mockRejectedValue(new Error("tmux failed")),
        capturePane: vi.fn(),
        sessionExists: vi.fn().mockResolvedValue(true),
      },
      config: makeConfig(),
      currentSessionManager: { get: vi.fn().mockResolvedValue("default") },
      queue: { size: vi.fn(), enqueue: vi.fn(), getSessionNames: vi.fn(), getSessionQueue: vi.fn(), getCurrentMessage: vi.fn(), isSessionProcessing: vi.fn() },
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.peek({
      match: "",
      reply,
      chat: { id: 3 },
      from: { id: 3 },
    } as any);

    expect(reply).toHaveBeenCalledWith("Peek failed: tmux failed", undefined);
  });

  it("/cwd rejects non-existing path", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");
    const queue = {
      size: vi.fn().mockReturnValue(0),
      enqueue: vi.fn().mockReturnValue("queued"),
      getSessionNames: vi.fn().mockReturnValue([]),
      getSessionQueue: vi.fn().mockReturnValue([]),
      getCurrentMessage: vi.fn(),
      isSessionProcessing: vi.fn().mockReturnValue(false),
    } as any;

    const deps = {
      bridge: { sessionExists: vi.fn().mockResolvedValue(true) },
      config: makeConfig({ allowedCwdRoots: ["/tmp"] }),
      currentSessionManager: { get: vi.fn().mockResolvedValue("default"), set: vi.fn() },
      queue,
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.cwd({
      match: "/does/not/exist",
      reply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    expect(reply).toHaveBeenCalledWith("Directory not found: /does/not/exist", undefined);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("/cwd allows configured roots and enqueues cd command", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");
    const tmpDir = fs.realpathSync(makeTempDir("telegram-bridge-cwd"));
    const queue = {
      size: vi.fn().mockReturnValue(0),
      enqueue: vi.fn().mockReturnValue("queued"),
      getSessionNames: vi.fn().mockReturnValue([]),
      getSessionQueue: vi.fn().mockReturnValue([]),
      getCurrentMessage: vi.fn(),
      isSessionProcessing: vi.fn().mockReturnValue(false),
    } as any;

    const deps = {
      bridge: { sessionExists: vi.fn().mockResolvedValue(true) },
      config: makeConfig({
        allowedCwdRoots: [tmpDir],
        sessionRateLimitMs: 0,
        globalRateLimitMs: 0,
      }),
      currentSessionManager: { get: vi.fn().mockResolvedValue("default"), set: vi.fn() },
      queue,
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.cwd({
      match: tmpDir,
      reply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      action: "command",
      text: expect.stringContaining(`cd ${JSON.stringify(tmpDir)} && pwd`),
      sessionName: "default",
    }));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("✅ Sent to default"), undefined);
  });

  it("/cwd expands ~ in target path when home is allowed", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");
    const queue = {
      size: vi.fn().mockReturnValue(0),
      enqueue: vi.fn().mockReturnValue("queued"),
      getSessionNames: vi.fn().mockReturnValue([]),
      getSessionQueue: vi.fn().mockReturnValue([]),
      getCurrentMessage: vi.fn(),
      isSessionProcessing: vi.fn().mockReturnValue(false),
    } as any;

    const homeDir = os.homedir();
    const deps = {
      bridge: { sessionExists: vi.fn().mockResolvedValue(true) },
      config: makeConfig({
        allowedCwdRoots: ["~"],
        sessionRateLimitMs: 0,
        globalRateLimitMs: 0,
      }),
      currentSessionManager: { get: vi.fn().mockResolvedValue("default"), set: vi.fn() },
      queue,
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.cwd({
      match: "~",
      reply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      action: "command",
      text: expect.stringContaining(`cd ${JSON.stringify(homeDir)} && pwd`),
      sessionName: "default",
    }));
  });

  it("/cwd rejects paths outside allowed roots", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");
    const root = fs.realpathSync(makeTempDir("telegram-bridge-cwd"));
    const outside = fs.realpathSync(makeTempDir("telegram-bridge-cwd-out"));
    const queue = {
      size: vi.fn().mockReturnValue(0),
      enqueue: vi.fn().mockReturnValue("queued"),
      getSessionNames: vi.fn().mockReturnValue([]),
      getSessionQueue: vi.fn().mockReturnValue([]),
      getCurrentMessage: vi.fn(),
      isSessionProcessing: vi.fn().mockReturnValue(false),
    } as any;

    const deps = {
      bridge: { sessionExists: vi.fn().mockResolvedValue(true) },
      config: makeConfig({
        allowedCwdRoots: [root],
        sessionRateLimitMs: 0,
        globalRateLimitMs: 0,
      }),
      currentSessionManager: { get: vi.fn().mockResolvedValue("default"), set: vi.fn() },
      queue,
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.cwd({
      match: outside,
      reply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    expect(reply).toHaveBeenCalledWith(`Path not allowed. Only within: ${root}`, undefined);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("/run rejects disallowed command through security gate", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");
    const queue = {
      size: vi.fn().mockReturnValue(0),
      enqueue: vi.fn().mockReturnValue("queued"),
      getSessionNames: vi.fn().mockReturnValue([]),
      getSessionQueue: vi.fn().mockReturnValue([]),
      getCurrentMessage: vi.fn(),
      isSessionProcessing: vi.fn().mockReturnValue(false),
    } as any;

    const deps = {
      bridge: { sessionExists: vi.fn().mockResolvedValue(true) },
      config: makeConfig({ sessionRateLimitMs: 0, globalRateLimitMs: 0 }),
      currentSessionManager: { get: vi.fn().mockResolvedValue(null), set: vi.fn() },
      queue,
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.run({
      message: { text: "/run echo hi" },
      match: "echo hi",
      reply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    expect(reply).toHaveBeenCalledWith("Rejected: command not allowed — use /esc · /enter · /interrupt · /up · /down · /exit · /new · /clear · or /run claude-<name> (no extra args)", undefined);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("/run accepts valid claude command and enqueues", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");
    const queue = {
      size: vi.fn().mockReturnValue(0),
      enqueue: vi.fn().mockReturnValue("queued"),
      getSessionNames: vi.fn().mockReturnValue([]),
      getSessionQueue: vi.fn().mockReturnValue([]),
      getCurrentMessage: vi.fn(),
      isSessionProcessing: vi.fn().mockReturnValue(false),
    } as any;

    const deps = {
      bridge: { sessionExists: vi.fn().mockResolvedValue(true) },
      config: makeConfig({ sessionRateLimitMs: 0, globalRateLimitMs: 0 }),
      currentSessionManager: { get: vi.fn().mockResolvedValue("default"), set: vi.fn() },
      queue,
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.run({
      message: { text: "/run claude-foo" },
      match: "claude-foo",
      reply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    expect(queue.enqueue).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("✅ Sent to default"), undefined);
  });

  it("/run rejects when usage is wrong", async () => {
    vi.resetModules();
    const { registerHandlers } = await import("../src/bot/handlers.js");
    const deps = {
      bridge: { sessionExists: vi.fn().mockResolvedValue(true) },
      config: makeConfig(),
      currentSessionManager: { get: vi.fn().mockResolvedValue("default"), set: vi.fn() },
      queue: { size: vi.fn(), enqueue: vi.fn(), getSessionNames: vi.fn(), getSessionQueue: vi.fn(), getCurrentMessage: vi.fn(), isSessionProcessing: vi.fn() },
    } as any;

    const { bot, commands } = buildBot();
    registerHandlers(bot as any, deps);

    const reply = vi.fn();
    await commands.run({
      message: { text: "/run" },
      match: "",
      reply,
      chat: { id: 1 },
      from: { id: 1 },
    } as any);

    expect(reply).toHaveBeenCalledWith("Usage: /run [session] <cmd>", undefined);
  });
});
