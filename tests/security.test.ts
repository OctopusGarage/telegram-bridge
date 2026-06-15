import { describe, expect, it } from "vitest";
import { validateCommand } from "../src/security.js";

const CLAUDE = ["claude(-[a-z]+)?"];

describe("validateCommand", () => {
  it("allows a command matching a configured pattern", () => {
    expect(validateCommand("claude", CLAUDE)).toEqual({ ok: true });
    expect(validateCommand("claude-test", CLAUDE)).toEqual({ ok: true });
  });

  it("is case-insensitive", () => {
    expect(validateCommand("Claude", CLAUDE)).toEqual({ ok: true });
  });

  it("auto-anchors patterns (no partial / trailing match)", () => {
    expect(validateCommand("claude --dangerously", CLAUDE).ok).toBe(false);
    expect(validateCommand("xclaude", CLAUDE).ok).toBe(false);
  });

  it("fails closed when no patterns are configured", () => {
    expect(validateCommand("claude", [])).toEqual({
      ok: false,
      reason: "no commands are allowed — set ALLOWED_RUN_PATTERNS to permit specific commands",
    });
  });

  it("rejects empty command", () => {
    expect(validateCommand("   ", CLAUDE)).toEqual({ ok: false, reason: "empty command" });
  });

  it("rejects a command not matching any pattern", () => {
    expect(validateCommand("echo hi", CLAUDE)).toEqual({
      ok: false,
      reason: "command not allowed by ALLOWED_RUN_PATTERNS",
    });
  });

  it("supports multiple patterns and ignores invalid regex", () => {
    const patterns = ["npm run [a-z:]+", "git status", "("];
    expect(validateCommand("npm run build", patterns).ok).toBe(true);
    expect(validateCommand("git status", patterns).ok).toBe(true);
    expect(validateCommand("rm -rf /", patterns).ok).toBe(false);
  });
});
