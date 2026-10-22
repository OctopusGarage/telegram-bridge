import { describe, expect, it, vi } from "vitest";
import { SecurityAlerts } from "../src/auth/alerts.js";
import { buildMiddleware } from "../src/bot/handlers.js";
import { loadConfig } from "../src/config.js";

const attempt = { userId: "99", chatId: "99", reason: "authorization" as const };
const TEN_MINUTES = 600_000;

function fixture(recipients = ["7", "8"]) {
  let now = 1_000_000;
  const send = vi.fn(async (_recipient: string, _text: string) => {});
  const alerts = new SecurityAlerts({ recipients, send, now: () => now });
  return {
    alerts,
    send,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("security alerts", () => {
  it("warns trusted recipients after five denials, never the rejected sender", async () => {
    const f = fixture();
    for (let n = 0; n < 4; n++) await f.alerts.record(attempt);
    expect(f.send).not.toHaveBeenCalled();
    await f.alerts.record(attempt);
    expect(f.send.mock.calls.map(([recipient]) => recipient)).toEqual(["7", "8"]);
    const message = f.send.mock.calls[0][1];
    expect(message).toContain("5 denied access attempts");
    expect(message).toContain("99");
    expect(message).toContain("/lock");
    expect(message).toContain("security revoke");
  });

  it("aggregates denials across senders and expires attempts outside the rolling window", async () => {
    const f = fixture(["7"]);
    for (let n = 0; n < 4; n++) await f.alerts.record(attempt);
    f.advance(TEN_MINUTES);
    await f.alerts.record(attempt);
    expect(f.send).not.toHaveBeenCalled();
    for (let n = 0; n < 4; n++) await f.alerts.record({ ...attempt, userId: String(100 + n) });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("suppresses a flood during cooldown and requires fresh attempts afterward", async () => {
    const f = fixture(["7"]);
    for (let n = 0; n < 100; n++) await f.alerts.record(attempt);
    expect(f.send).toHaveBeenCalledTimes(1);
    f.advance(TEN_MINUTES);
    for (let n = 0; n < 4; n++) await f.alerts.record(attempt);
    expect(f.send).toHaveBeenCalledTimes(1);
    await f.alerts.record(attempt);
    expect(f.send).toHaveBeenCalledTimes(2);
  });

  it("reserves cooldown before sending concurrent alerts", async () => {
    const f = fixture(["7"]);
    await Promise.all(Array.from({ length: 25 }, () => f.alerts.record(attempt)));
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("isolates recipient delivery failures and never logs Telegram error payloads", async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce(new Error("sensitive-api-payload"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let n = 0; n < 5; n++) await expect(f.alerts.record(attempt)).resolves.toBeUndefined();
      expect(f.send).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive-api-payload");
      await f.alerts.record(attempt);
      expect(f.send).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("counts middleware rejections without copying submitted content into alerts", async () => {
    const f = fixture(["7"]);
    const config = loadConfig({ BOT_TOKEN: "test", ALLOWED_USER_IDS: "7" });
    const middleware = buildMiddleware(config, (denied) => {
      void f.alerts.record(denied);
    });
    const next = vi.fn();
    const ctx = {
      from: { id: 99 },
      chat: { id: 99, type: "private" },
      message: { text: "/approve private-request private-code" },
      reply: vi.fn(),
    };
    for (let n = 0; n < 5; n++) await middleware(ctx as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send.mock.calls[0][1]).not.toContain("private-code");
    expect(f.send.mock.calls[0][1]).not.toContain("private-request");
  });

  it("counts non-private chat rejections, but not successful requests or ordinary throttling", async () => {
    const f = fixture(["7"]);
    const report = vi.fn((denied) => {
      void f.alerts.record(denied);
    });
    const config = loadConfig({ BOT_TOKEN: "test", ALLOWED_USER_IDS: "7666" });
    const middleware = buildMiddleware(config, report);
    const next = vi.fn();
    const ctx = {
      from: { id: 7666 },
      chat: { id: 7666, type: "private" },
      reply: vi.fn(),
      message: { text: "/help" },
    };
    await middleware(ctx as any, next);
    await middleware(ctx as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    await middleware({ ...ctx, chat: { id: -1, type: "group" } } as any, next);
    expect(report).toHaveBeenCalledExactlyOnceWith({
      userId: "7666",
      chatId: "-1",
      reason: "private-chat",
    });
  });
});
