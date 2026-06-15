import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageQueue, type QueuedMessage } from "../../src/core/queue.js";

const TEST_DIR = path.join(os.tmpdir(), "telegram-bridge-core-queue-tests");
const PERSIST_PATH = path.join(TEST_DIR, ".queue", "pending.json");

type MsgBuilder = (overrides: Partial<QueuedMessage>) => QueuedMessage;

function deferred() {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return {
    promise,
    resolve: () => {
      if (resolve) {
        resolve();
      }
    },
  };
}

const makeMessage: MsgBuilder = (overrides) => ({
  id: "msg-id",
  text: "command",
  chatId: 1,
  sessionName: "session",
  action: "command",
  resolve: vi.fn(),
  reject: vi.fn(),
  ...overrides,
});

function newQueue(maxConcurrentSessions = Infinity): MessageQueue {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(PERSIST_PATH), { recursive: true });
  return new MessageQueue(10, PERSIST_PATH, maxConcurrentSessions);
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MessageQueue persistence", () => {
  it("persists and loads pending messages", () => {
    const queue = newQueue();
    const blocker = deferred();
    queue.setHandler(async () => {
      await blocker.promise;
    });

    const msg = makeMessage({ id: "m1", text: "hello" });
    const verdict = queue.enqueue(msg);

    expect(verdict).toBe("queued");
    queue.flushPending();
    blocker.resolve();

    const loaded = queue.loadPersisted();
    expect(loaded).toEqual([
      {
        id: "m1",
        text: "hello",
        chatId: 1,
        sessionName: "session",
        action: "command",
      },
    ]);
  });

  it("restores inflight message state for restart recovery", async () => {
    const queue = newQueue();
    const blocker = deferred();
    queue.setHandler(async () => {
      await blocker.promise;
    });

    queue.enqueue(makeMessage({ id: "in-flight" }));

    queue.flushPending();
    const loaded = queue.loadPersisted();
    expect(loaded.find((item) => item.id === "in-flight")).toBeDefined();

    blocker.resolve();
    await Promise.resolve();
  });

  it("returns [] when persisted file contains invalid payload", () => {
    const queue = newQueue();
    fs.writeFileSync(PERSIST_PATH, '{"invalid":"payload"}');
    expect(queue.loadPersisted()).toEqual([]);
  });

  it("falls back to legacy queue file when app state queue is missing", () => {
    const legacyDir = path.join(os.tmpdir(), `telegram-bridge-core-queue-legacy-${Date.now()}`);
    const legacyPath = path.join(legacyDir, ".queue", "pending.json");
    const legacyPayload = JSON.stringify(
      [
        {
          id: "legacy-1",
          text: "legacy message",
          chatId: 42,
          sessionName: "session",
          action: "command",
        },
      ],
      null,
      2,
    );

    const originalCwd = process.cwd();
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(PERSIST_PATH), { recursive: true });
      fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
      fs.writeFileSync(legacyPath, legacyPayload, "utf-8");

      process.chdir(legacyDir);
      const queue = new MessageQueue(10, PERSIST_PATH);
      const loaded = queue.loadPersisted();

      expect(loaded).toEqual([
        {
          id: "legacy-1",
          text: "legacy message",
          chatId: 42,
          sessionName: "session",
          action: "command",
        },
      ]);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it("clearPersisted deletes legacy queue file too", () => {
    const legacyDir = path.join(
      os.tmpdir(),
      `telegram-bridge-core-queue-legacy-clear-${Date.now()}`,
    );
    const legacyPath = path.join(legacyDir, ".queue", "pending.json");

    const originalCwd = process.cwd();
    try {
      const persistLegacyPayload = JSON.stringify(
        [
          {
            id: "legacy-2",
            text: "to clear",
            chatId: 7,
            sessionName: "session",
            action: "command",
          },
        ],
        null,
        2,
      );
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(PERSIST_PATH), { recursive: true });
      fs.writeFileSync(PERSIST_PATH, persistLegacyPayload, "utf-8");
      fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
      fs.writeFileSync(legacyPath, persistLegacyPayload, "utf-8");

      process.chdir(legacyDir);
      const queue = new MessageQueue(10, PERSIST_PATH);
      expect(fs.existsSync(PERSIST_PATH)).toBe(true);
      expect(fs.existsSync(legacyPath)).toBe(true);

      queue.clearPersisted();

      expect(fs.existsSync(PERSIST_PATH)).toBe(false);
      expect(fs.existsSync(legacyPath)).toBe(false);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});

describe("MessageQueue backpressure and cancellation", () => {
  it("defers sessions when concurrent session limit is reached", async () => {
    vi.useFakeTimers();
    const queue = newQueue(1);
    const started: string[] = [];
    const blocker = deferred();

    queue.setHandler(async (msg) => {
      started.push(msg.id);
      if (msg.id === "first") {
        await blocker.promise;
      }
    });

    queue.enqueue(makeMessage({ id: "first" }));
    queue.enqueue(makeMessage({ id: "second", text: "second" }));
    await vi.runAllTimersAsync();

    expect(started).toEqual(["first"]);

    blocker.resolve();
    await vi.runAllTimersAsync();
    expect(started).toEqual(["first", "second"]);
    vi.useRealTimers();
  });

  it("clear rejects in-flight and queued messages", async () => {
    const queue = newQueue();
    const blocker = deferred();
    queue.setHandler(async () => {
      await blocker.promise;
    });

    const firstReject = vi.fn();
    const secondReject = vi.fn();

    queue.enqueue(makeMessage({ id: "first", reject: firstReject }));
    queue.enqueue(makeMessage({ id: "second", reject: secondReject, text: "second" }));
    await Promise.resolve();

    queue.clear();

    expect(firstReject).toHaveBeenCalledWith(expect.any(Error));
    expect(secondReject).toHaveBeenCalledWith(expect.any(Error));
    expect(queue.size()).toBe(0);
  });

  it("dedupes duplicated command text in the same session", () => {
    const queue = newQueue();
    const rejectA = vi.fn();
    const rejectB = vi.fn();
    const blocker = deferred();
    queue.setHandler(async () => {
      await blocker.promise;
    });

    expect(queue.enqueue(makeMessage({ id: "first", text: "echo hi", reject: rejectA }))).toBe(
      "queued",
    );
    expect(queue.enqueue(makeMessage({ id: "second", text: "echo hi", reject: rejectB }))).toBe(
      "duplicate",
    );
    expect(queue.enqueue(makeMessage({ id: "third", text: "echo bye" }))).toBe("queued");
    expect(queue.enqueue(makeMessage({ id: "fourth", text: "echo hi", action: "raw-key" }))).toBe(
      "queued",
    );

    blocker.resolve();
  });

  it("dedupes duplicated command text while first message is still in flight", async () => {
    const queue = newQueue();
    const blocker = deferred();
    queue.setHandler(async () => {
      await blocker.promise;
    });

    expect(queue.enqueue(makeMessage({ id: "first", text: "echo hi" }))).toBe("queued");
    expect(queue.enqueue(makeMessage({ id: "second", text: "echo hi" }))).toBe("duplicate");

    blocker.resolve();
  });

  it("clearSession rejects in-flight and queued messages", async () => {
    const queue = newQueue();
    const blocker = deferred();
    const rejectInFlight = vi.fn();
    const rejectQueued = vi.fn();

    queue.setHandler(async () => {
      await blocker.promise;
    });

    queue.enqueue(makeMessage({ id: "running", reject: rejectInFlight }));
    queue.enqueue(makeMessage({ id: "waiting", text: "next", reject: rejectQueued }));
    await Promise.resolve();

    queue.clearSession("session");

    expect(rejectInFlight).toHaveBeenCalledWith(expect.any(Error));
    expect(rejectQueued).toHaveBeenCalledWith(expect.any(Error));
    expect(queue.size()).toBe(0);
  });

  it("clearSession does nothing when session does not exist", () => {
    const queue = newQueue();
    queue.clearSession("missing");
    expect(queue.size()).toBe(0);
  });

  it("exposes in-flight sessions through getSessionNames", async () => {
    const queue = newQueue();
    const blocker = deferred();
    queue.setHandler(async () => {
      await blocker.promise;
    });

    queue.enqueue(makeMessage({ id: "running", sessionName: "alpha" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(queue.getSessionNames()).toContain("alpha");
    blocker.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queue.getSessionNames()).not.toContain("alpha");
  });
});
