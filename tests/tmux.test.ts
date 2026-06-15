import { describe, expect, it, vi } from "vitest";
import { TmuxBridge } from "../src/services/tmux.js";

describe("TmuxBridge", () => {
  it("formats target pane correctly when sending a command", async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const bridge = new TmuxBridge({
      execFile,
      target: { session: "session", window: 1, pane: 2 },
    });

    await bridge.sendCommand("pwd");

    expect(execFile).toHaveBeenCalledWith("tmux", ["send-keys", "-t", "session:1.2", "pwd", "C-m"]);
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
    expect(execFile).toHaveBeenCalledWith("tmux", ["kill-session", "-t", "old"]);
  });
});
