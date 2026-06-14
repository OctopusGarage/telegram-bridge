import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appStateDir, appStateFile, stateDir } from "../../src/core/state-dir.js";

const originalStateDir = process.env.TGB_STATE_DIR;

afterEach(() => {
  if (originalStateDir === undefined) {
    delete process.env.TGB_STATE_DIR;
  } else {
    process.env.TGB_STATE_DIR = originalStateDir;
  }
});

describe("stateDir", () => {
  it("falls back to default app state dir", () => {
    delete process.env.TGB_STATE_DIR;
    expect(stateDir("/fallback")).toBe("/fallback");
    expect(appStateDir()).toBe(join(homedir(), ".telegram-bridge"));
  });

  it("honors TGB_STATE_DIR override", () => {
    process.env.TGB_STATE_DIR = "/tmp/telegram-bridge-state";
    expect(appStateDir()).toBe("/tmp/telegram-bridge-state");
    expect(appStateFile("pending.json")).toBe("/tmp/telegram-bridge-state/pending.json");
  });
});
