import { describe, expect, it } from "vitest";
import { validateCommand } from "../src/security.js";

describe("validateCommand", () => {
  it("allows claude command", () => {
    expect(validateCommand("claude")).toEqual({ ok: true });
  });

  it("allows versioned claude command", () => {
    expect(validateCommand("claude-test")).toEqual({ ok: true });
  });

  it("rejects empty command", () => {
    expect(validateCommand("   ")).toEqual({ ok: false, reason: "empty command" });
  });

  it("rejects unsupported command", () => {
    expect(validateCommand("echo hi")).toEqual({
      ok: false,
      reason: "command not allowed — use /esc · /enter · /interrupt · /up · /down · /exit · /new · /clear · or /run claude-<name> (no extra args)",
    });
  });
});
