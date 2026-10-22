import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Secret, TOTP } from "otpauth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Authorization } from "../src/auth/authorization.js";
import {
  buildMiddleware,
  executeQueuedCommand,
  registerHandlers,
  stopRateLimitCleanup,
} from "../src/bot/handlers.js";
import { loadConfig } from "../src/config.js";
import { CurrentSessionManager } from "../src/services/currentSession.js";

const dirs: string[] = [];
afterEach(() => {
  stopRateLimitCleanup();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bridge-handlers-auth-"));
  dirs.push(dir);
  const secret = new Secret().base32;
  let now = Date.now();
  const config = loadConfig({
    BOT_TOKEN: "test",
    TMUX_SESSION: "work",
    ALLOWED_USER_IDS: "7",
    ALLOWED_RUN_PATTERNS: "pwd",
    TOTP_SECRET: secret,
  });
  config.sessionRateLimitMs = 0;
  config.globalRateLimitMs = 0;
  const auth = new Authorization({
    secret,
    statePath: join(dir, "security", "state.json"),
    allowedUserIds: config.allowedUserIds,
    ...config.security!,
    now: () => now,
  });
  const commands: Record<string, (ctx: any) => Promise<void>> = {};
  const on: Record<string, (ctx: any) => Promise<void>> = {};
  const queue = {
    enqueue: vi.fn().mockReturnValue("queued"),
    size: () => 0,
    getSessionNames: () => [],
    getSessionQueue: () => [{ text: "pending work" }],
    getCurrentMessage: () => ({ text: "running work" }),
    isSessionProcessing: () => true,
    clearSession: vi.fn(),
    clear: vi.fn(),
  };
  const bridge = {
    sessionExists: async () => true,
    ensurePaneExists: async () => {},
    listSessionNames: async () => ["work", "unrelated"],
    paneIdentity: vi.fn().mockResolvedValue("1:$1:%1:10"),
    sendCommand: vi.fn(),
    sendRawKey: vi.fn(),
    killSession: vi.fn(),
    capturePane: vi.fn().mockResolvedValue("secret output"),
  };
  const deps = {
    config,
    auth,
    bridge,
    queue,
    currentSessionManager: new CurrentSessionManager(dir),
  } as any;
  registerHandlers(
    {
      command: (name: string, cb: any) => {
        commands[name] = cb;
      },
      on: (name: string, cb: any) => {
        on[name] = cb;
      },
    } as any,
    deps,
  );
  const reply = vi.fn();
  const ctx = (match = "", text = "") => ({
    from: { id: 7 },
    chat: { id: 7, type: "private" },
    match,
    message: { text },
    reply,
    deleteMessage: vi.fn().mockResolvedValue(true),
  });
  const otp = () => new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp: now });
  const unlock = () =>
    auth.confirm(
      { userId: "7", chatId: "7" },
      auth.request({ userId: "7", chatId: "7" }, "unlock", "work").id,
      otp(),
    );
  return {
    commands,
    on,
    ctx,
    reply,
    deps,
    auth,
    queue,
    bridge,
    unlock,
    otp,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("protected Telegram operations", () => {
  it("preserves detailed queue status within the authorized session", async () => {
    const f = fixture();
    f.unlock();
    await f.commands.queue_status(f.ctx());
    const message = String(f.reply.mock.calls.at(-1)?.[0]);
    expect(message).toContain("pending work");
    expect(message).toContain("running work");
    expect(message).not.toContain("unrelated");
  });
  it("always permits emergency locking through the ordinary message rate limiter", async () => {
    const f = fixture();
    const middleware = buildMiddleware(f.deps.config);
    const next = vi.fn();
    await middleware(f.ctx("", "/help") as any, next);
    await middleware(f.ctx("", "/lock") as any, next);
    expect(next).toHaveBeenCalledTimes(2);
  });
  it("rejects unknown users at the entry even with the deprecated allow-all switch", async () => {
    const f = fixture();
    f.deps.config.allowAllUsers = true;
    const ctx = f.ctx();
    ctx.from.id = 99;
    ctx.chat.id = 99;
    const next = vi.fn();
    await buildMiddleware(f.deps.config)(ctx as any, next);
    expect(next).not.toHaveBeenCalled();
  });
  it("does not echo a mistakenly submitted bare verification code", async () => {
    const f = fixture();
    const ctx = f.ctx("", "123456");
    await f.on["message:text"](ctx);
    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(String(f.reply.mock.calls.at(-1)?.[0])).not.toContain("123456");
    expect(f.queue.enqueue).not.toHaveBeenCalled();
  });
  it("denies raw keys, pane reads and commands until second-factor verification", async () => {
    const f = fixture();
    for (const name of ["up", "enter", "interrupt", "peek"])
      await expect(f.commands[name](f.ctx())).rejects.toThrow(/unlock|locked/i);
    await expect(f.commands.run(f.ctx("pwd", "/run pwd"))).rejects.toThrow(/unlock|locked/i);
    expect(f.queue.enqueue).not.toHaveBeenCalled();
    expect(f.bridge.capturePane).not.toHaveBeenCalled();
  });
  it("supports the unlock/approve flow and never executes the submitted code as text", async () => {
    const f = fixture();
    await f.commands.unlock(f.ctx());
    const message = String(f.reply.mock.calls.at(-1)?.[0]);
    const id = message.match(/\/approve ([a-f0-9]+)/)?.[1];
    expect(id).toBeTruthy();
    const approvalCtx = f.ctx(`${id} ${f.otp()}`);
    await f.commands.approve(approvalCtx);
    expect(approvalCtx.deleteMessage).toHaveBeenCalled();
    await f.commands.up(f.ctx());
    const msg = f.queue.enqueue.mock.calls[0][0];
    const resolve = vi.fn(),
      reject = vi.fn();
    await executeQueuedCommand({ ...msg, resolve, reject }, f.deps);
    expect(reject).not.toHaveBeenCalled();
    expect(f.bridge.sendRawKey).toHaveBeenCalledWith("Up", "work");
    expect(f.bridge.sendCommand).not.toHaveBeenCalled();
  });
  it("rechecks revocation, grants and pane identity at execution time", async () => {
    const f = fixture();
    f.unlock();
    await f.commands.enter(f.ctx());
    const msg = f.queue.enqueue.mock.calls[0][0];
    f.auth.lock({ userId: "7", chatId: "7" });
    const reject = vi.fn();
    await executeQueuedCommand({ ...msg, reject }, f.deps);
    expect(reject).toHaveBeenCalled();
    expect(f.bridge.sendRawKey).not.toHaveBeenCalled();
    f.advance(30_000);
    f.unlock();
    await f.commands.enter(f.ctx());
    const second = f.queue.enqueue.mock.calls.at(-1)![0];
    f.bridge.paneIdentity.mockResolvedValue("1:$1:%2:20");
    await executeQueuedCommand({ ...second, reject }, f.deps);
    expect(f.bridge.sendRawKey).not.toHaveBeenCalled();
  });
  it("filters unrelated sessions and requires a separate immutable approval for removal", async () => {
    const f = fixture();
    f.unlock();
    await f.commands.sessions(f.ctx());
    expect(String(f.reply.mock.calls.at(-1)?.[0])).not.toContain("unrelated");
    await f.commands.remove(f.ctx("1"));
    expect(f.bridge.killSession).not.toHaveBeenCalled();
    const message = String(f.reply.mock.calls.at(-1)?.[0]);
    const id = message.match(/\/approve ([a-f0-9]+)/)?.[1];
    expect(id).toBeTruthy();
    f.advance(30_000);
    await f.commands.approve(f.ctx(`${id} ${f.otp()}`));
    expect(f.bridge.killSession).toHaveBeenCalledWith("work");
    expect(f.queue.clearSession).toHaveBeenCalledWith("work");
  });
  it("rejects restored messages without in-memory authorization metadata", async () => {
    const f = fixture();
    f.unlock();
    const reject = vi.fn();
    await executeQueuedCommand(
      {
        id: "old",
        text: "pwd",
        chatId: 7,
        sessionName: "work",
        action: "command",
        resolve: vi.fn(),
        reject,
      },
      f.deps,
    );
    expect(reject).toHaveBeenCalled();
    expect(f.bridge.sendCommand).not.toHaveBeenCalled();
  });
});
