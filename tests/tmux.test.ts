import { describe, expect, it, vi } from "vitest";
import { TmuxBridge } from "../src/services/tmux.js";

describe("TmuxBridge", () => {
  it("formats target pane correctly when sending a command", async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const bridge = new TmuxBridge({
      execFile,
      target: { session: "session", window: 1, pane: 2 }
    });

    await bridge.sendCommand("pwd");

    expect(execFile).toHaveBeenCalledWith("tmux", ["send-keys", "-t", "session:1.2", "pwd", "C-m"]);
  });
});
