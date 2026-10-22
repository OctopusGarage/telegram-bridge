import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { TmuxBridge } from "../src/services/tmux.js";

it.skipIf(spawnSync("tmux", ["-V"]).status !== 0)(
  "delivers literal text on an independent real tmux server",
  async () => {
    const socket = `bridge-test-${randomUUID()}`;
    const target = { session: "audit", window: 0, pane: 0 };
    try {
      execFileSync("tmux", [
        "-L",
        socket,
        "-f",
        "/dev/null",
        "new-session",
        "-d",
        "-s",
        "audit",
        "/usr/bin/env",
        "-i",
        "/bin/cat",
      ]);
      const bridge = new TmuxBridge({ socket, target });
      expect(await bridge.listSessionNames()).toEqual(["audit"]);
      expect(await bridge.paneIdentity("audit")).toMatch(/^\d+:\$\d+:%\d+:\d+$/);
      await bridge.sendCommand("Up");
      await bridge.sendCommand("-R");
      await expect.poll(async () => bridge.capturePane(), { timeout: 2000 }).toContain("Up");
      expect(await bridge.capturePane()).toContain("-R");
      await bridge.killSession("audit");
    } finally {
      spawnSync("tmux", ["-L", socket, "kill-server"]);
    }
  },
);
