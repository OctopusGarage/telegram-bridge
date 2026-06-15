import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CurrentSessionManager } from "../../src/services/currentSession.js";

const TEST_DIR = path.join(os.tmpdir(), "test_current_session");
const TEST_FILE = path.join(TEST_DIR, ".current_tmux_session");

describe("CurrentSessionManager", () => {
  beforeEach(() => {
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: string }).code === "ENOENT"
        )
      ) {
        throw error;
      }
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  it("get returns null when file does not exist", async () => {
    const mgr = new CurrentSessionManager(TEST_DIR);
    const result = await mgr.get();
    expect(result).toBeNull();
  });

  it("set writes session name to file", async () => {
    const mgr = new CurrentSessionManager(TEST_DIR);
    await mgr.set("my_session");
    const content = fs.readFileSync(TEST_FILE, "utf-8");
    expect(content).toBe("my_session");
  });

  it("get returns saved session name", async () => {
    const mgr = new CurrentSessionManager(TEST_DIR);
    await mgr.set("my_session");
    const result = await mgr.get();
    expect(result).toBe("my_session");
  });

  it("clear removes the file", async () => {
    const mgr = new CurrentSessionManager(TEST_DIR);
    await mgr.set("my_session");
    await mgr.clear();
    expect(fs.existsSync(TEST_FILE)).toBe(false);
  });

  it("set updates cached value without second disk read", async () => {
    const mgr = new CurrentSessionManager(TEST_DIR);
    await mgr.set("session_a");
    fs.writeFileSync(TEST_FILE, "tampered", "utf-8");

    const result = await mgr.get();
    expect(result).toBe("session_a");
  });

  it("set updates cache and file", async () => {
    const mgr = new CurrentSessionManager(TEST_DIR);
    await mgr.set("session_a");
    await mgr.set("session_b");
    const result = await mgr.get();
    expect(result).toBe("session_b");
  });
});
