import { describe, expect, it, vi } from "vitest";
import { TmuxBridge, tmuxEnvironment } from "../src/services/tmux.js";

describe("TmuxBridge", () => {
  it("does not pass backend credentials into a new tmux server or terminal", () => {
    const env = tmuxEnvironment({
      BOT_TOKEN: "bot-test",
      TOTP_SECRET: "otp-test",
      PATH: "/bin",
      TOOL_SETTING: "keep",
    });
    expect(env).toEqual({ PATH: "/bin", TOOL_SETTING: "keep" });
  });
  it("formats target pane correctly when sending a command", async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const bridge = new TmuxBridge({
      execFile,
      target: { session: "session", window: 1, pane: 2 },
    });

    await bridge.sendCommand("pwd");

    expect(execFile).toHaveBeenNthCalledWith(1, "tmux", [
      "send-keys",
      "-t",
      "=session:1.2",
      "-l",
      "--",
      "pwd",
    ]);
    expect(execFile).toHaveBeenNthCalledWith(2, "tmux", [
      "send-keys",
      "-t",
      "=session:1.2",
      "Enter",
    ]);
  });

  it("parses session names from list-sessions output", async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: "work: 1 windows (created ...)\ndev: 2 windows (created ...)\n",
      stderr: "",
    });
    const bridge = new TmuxBridge({
      execFile,
      target: { session: "session", window: 0, pane: 0 },
    });

    const sessions = await bridge.listSessionNames();

    expect(sessions).toEqual(["work", "dev"]);
    expect(execFile).toHaveBeenCalledWith("tmux", ["list-sessions"]);
  });

  it("reports whether a session exists", async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: "work: 1 windows\ndev: 2 windows\n",
      stderr: "",
    });
    const bridge = new TmuxBridge({
      execFile,
      target: { session: "session", window: 0, pane: 0 },
    });

    expect(await bridge.sessionExists("dev")).toBe(true);
    expect(await bridge.sessionExists("missing")).toBe(false);
  });

  it("ensureSession creates a detached session when missing", async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: "work: 1 windows\n", stderr: "" });
    const bridge = new TmuxBridge({
      execFile,
      target: { session: "session", window: 0, pane: 0 },
    });

    await bridge.ensureSession("newone");
    expect(execFile).toHaveBeenCalledWith("tmux", ["new-session", "-d", "-s", "newone"]);
  });

  it("ensureSession is a no-op when the session already exists", async () => {
    const execFile = vi
      .fn()
      .mockResolvedValue({ stdout: "work: 1 windows\ndev: 2 windows\n", stderr: "" });
    const bridge = new TmuxBridge({
      execFile,
      target: { session: "session", window: 0, pane: 0 },
    });

    await bridge.ensureSession("dev");
    expect(execFile).not.toHaveBeenCalledWith("tmux", ["new-session", "-d", "-s", "dev"]);
  });

  it("kills tmux session", async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const bridge = new TmuxBridge({
      execFile,
      target: { session: "session", window: 0, pane: 0 },
    });

    await bridge.killSession("old");
    expect(execFile).toHaveBeenCalledWith("tmux", ["kill-session", "-t", "=old"]);
  });
  it("uses a configured socket for every operation and returns pane generation identity", async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: "42:$1:%2:123\n", stderr: "" });
    const bridge = new TmuxBridge({
      execFile,
      socket: "bridge",
      target: { session: "work", window: 0, pane: 0 },
    });
    expect(await bridge.paneIdentity("work")).toBe("42:$1:%2:123");
    await bridge.sendRawKey("Up", "work");
    expect(execFile).toHaveBeenLastCalledWith("tmux", [
      "-L",
      "bridge",
      "send-keys",
      "-t",
      "=work:0.0",
      "Up",
    ]);
  });
});
