import { describe, expect, it, vi } from "vitest";
import { parseRunCommand, resolveHandlerContext, formatSessionsList, switchToSession } from "../src/bot/handlers.js";

describe("resolveHandlerContext", () => {
  it("resolveHandlerContext uses currentSessionManager when arg is null", async () => {
    const mockBridge = {
      sessionExists: vi.fn().mockResolvedValue(true),
    } as any;
    const mockConfig = { tmuxTarget: { session: "config_default", window: 0, pane: 0 } } as any;
    const mockCurrentSession = { get: vi.fn().mockResolvedValue("saved_session"), exists: vi.fn().mockResolvedValue(true) } as any;

    const deps = { bridge: mockBridge, config: mockConfig, currentSessionManager: mockCurrentSession };
    const result = await resolveHandlerContext(null, deps);

    expect(result.session).toBe("saved_session");
  });

  it("resolveHandlerContext uses arg when provided, even if currentSessionManager has a value", async () => {
    const mockBridge = {
      sessionExists: vi.fn().mockResolvedValue(true),
    } as any;
    const mockConfig = { tmuxTarget: { session: "config_default", window: 0, pane: 0 } } as any;
    const mockCurrentSession = { get: vi.fn().mockResolvedValue("saved_session"), exists: vi.fn().mockResolvedValue(true) } as any;

    const deps = { bridge: mockBridge, config: mockConfig, currentSessionManager: mockCurrentSession };
    const result = await resolveHandlerContext("other_session", deps);

    expect(result.session).toBe("other_session");
  });
});

describe("parseRunCommand", () => {
  it("extracts the shell command after /run", () => {
    expect(parseRunCommand("/run ls -la", [])).toEqual({ session: null, command: "ls -la" });
  });

  it("supports bot-qualified commands", () => {
    expect(parseRunCommand("/run@bridge_bot echo hi", [])).toEqual({ session: null, command: "echo hi" });
  });

  it("returns null when the command is missing", () => {
    expect(parseRunCommand("/run", [])).toBeNull();
  });
});

describe("formatSessionsList", () => {
  it("formatSessionsList pins current session with marker", () => {
    const sessions = ["work", "dev", "my_session"];
    const output = formatSessionsList(sessions, "my_session");
    expect(output).toContain("✅");
    expect(output).toContain("my_session");
    expect(output).toContain("/attach_1");
    expect(output).toContain("/attach_3");
  });

  it("formatSessionsList returns 'No tmux sessions' for empty", () => {
    const output = formatSessionsList([], null);
    expect(output).toBe("No tmux sessions running.");
  });
});

describe("switchToSession", () => {
  it("switchToSession sets session by index", async () => {
    const sessions = ["work", "dev", "my_session"];
    const mockBridge = { listSessionNames: vi.fn().mockResolvedValue(sessions) } as any;
    const mockConfig = { tmuxTarget: { session: "config_default", window: 0, pane: 0 } } as any;
    const mockCurrentSession = { get: vi.fn().mockResolvedValue(null), set: vi.fn() } as any;
    const mockCtx = { reply: vi.fn() } as any;

    const deps = { bridge: mockBridge, config: mockConfig, currentSessionManager: mockCurrentSession };

    await switchToSession(mockCtx, 1, deps);

    expect(mockCurrentSession.set).toHaveBeenCalledWith("dev");
  });

  it("switchToSession handles out of range index", async () => {
    const sessions = ["work", "dev"];
    const mockBridge = { listSessionNames: vi.fn().mockResolvedValue(sessions) } as any;
    const mockConfig = { tmuxTarget: { session: "config_default", window: 0, pane: 0 } } as any;
    const mockCurrentSession = { get: vi.fn().mockResolvedValue(null), set: vi.fn() } as any;
    const mockCtx = { reply: vi.fn() } as any;

    const deps = { bridge: mockBridge, config: mockConfig, currentSessionManager: mockCurrentSession };

    await switchToSession(mockCtx, 99, deps);

    expect(mockCurrentSession.set).not.toHaveBeenCalled();
    expect(mockCtx.reply).toHaveBeenCalledWith("Index out of range (1–2).", undefined);
  });
});