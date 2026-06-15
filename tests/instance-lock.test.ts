import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DIR = path.join(os.tmpdir(), `telegram-bridge-instance-lock-${Date.now()}`);

describe("instance-lock", () => {
  const originalCwd = process.cwd();
  const originalStateDir = process.env.TGB_STATE_DIR;

  const lockPath = () => path.join(process.env.TGB_STATE_DIR!, "instance.lock");

  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    process.chdir(TEST_DIR);
    process.env.TGB_STATE_DIR = TEST_DIR;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    if (originalStateDir === undefined) {
      delete process.env.TGB_STATE_DIR;
    } else {
      process.env.TGB_STATE_DIR = originalStateDir;
    }
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("acquires and releases lock file", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFileSync: vi.fn(),
    }));
    const { acquireInstanceLock, releaseInstanceLock } = await import(
      "../src/core/instance-lock.js"
    );

    acquireInstanceLock();
    const raw = fs.readFileSync(lockPath(), "utf-8");
    expect(raw).toContain(`"pid":${process.pid}`);

    releaseInstanceLock();
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it("replaces stale lock held by non-running or non-bot process", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFileSync: vi.fn(),
    }));
    const { acquireInstanceLock, releaseInstanceLock } = await import(
      "../src/core/instance-lock.js"
    );

    const holder = { pid: 999999, startedAt: new Date().toISOString() };
    fs.writeFileSync(lockPath(), JSON.stringify(holder), "utf-8");

    vi.spyOn(process, "kill").mockImplementation((pid: any) => {
      if (pid === holder.pid) {
        const error = new Error("not running") as NodeJS.ErrnoException;
        error.code = "ESRCH";
        throw error;
      }
      return true;
    });

    acquireInstanceLock();

    const raw = fs.readFileSync(lockPath(), "utf-8");
    expect(raw).toContain(`"pid":${process.pid}`);

    releaseInstanceLock();
  });

  it("throws InstanceLockHeldError if another alive bot is holding lock", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFileSync: vi.fn().mockReturnValue("telegram-bridge\n"),
    }));
    const { acquireInstanceLock, InstanceLockHeldError } = await import(
      "../src/core/instance-lock.js"
    );

    const holder = { pid: 999999, startedAt: new Date().toISOString() };
    fs.writeFileSync(lockPath(), JSON.stringify(holder), "utf-8");

    vi.spyOn(process, "kill").mockImplementation(() => true);

    expect(() => acquireInstanceLock()).toThrow(InstanceLockHeldError);
    expect(fs.existsSync(lockPath())).toBe(true);
  });

  it("allows takeover when holder is alive but not a bot process", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFileSync: vi.fn(),
    }));
    const { acquireInstanceLock } = await import("../src/core/instance-lock.js");

    const holder = { pid: 999999, startedAt: new Date().toISOString() };
    fs.writeFileSync(lockPath(), JSON.stringify(holder), "utf-8");

    acquireInstanceLock({
      isAlive: (pid) => pid === holder.pid,
      isBotProcess: () => false,
    });

    const raw = fs.readFileSync(lockPath(), "utf-8");
    expect(raw).toContain(`"pid":${process.pid}`);
  });
});
