import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { appStateFile } from "./state-dir.js";

const LOCK_FILE = "instance.lock";
const BOT_PROCESS_MARKER = "telegram-bridge";

export interface ProcessProbe {
  isAlive(pid: number): boolean;
  isBotProcess(pid: number): boolean;
}

export interface InstanceLockHolder {
  pid: number;
  startedAt: string;
}

export class InstanceLockHeldError extends Error {
  constructor(readonly holder: InstanceLockHolder) {
    super(`another instance is already running (pid=${holder.pid}, since ${holder.startedAt})`);
    this.name = "InstanceLockHeldError";
  }
}

const lockPath = (): string => appStateFile(LOCK_FILE);

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isBotProcess(pid: number): boolean {
  try {
    const cmd = execFileSync("ps", ["-ww", "-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 5000,
    });
    return cmd.includes(BOT_PROCESS_MARKER);
  } catch {
    return false;
  }
}

const defaultProbe: ProcessProbe = { isAlive, isBotProcess };

function readHolder(): InstanceLockHolder | undefined {
  try {
    const raw = fs.readFileSync(lockPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<InstanceLockHolder>;
    if (typeof parsed.pid !== "number" || typeof parsed.startedAt !== "string") return undefined;
    return { pid: parsed.pid, startedAt: parsed.startedAt };
  } catch {
    return undefined;
  }
}

function tryCreate(): boolean {
  const payload = `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`;
  try {
    fs.mkdirSync(path.dirname(lockPath()), { recursive: true });
    fs.writeFileSync(lockPath(), payload, { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function removeIfHolder(expected: InstanceLockHolder | undefined): boolean {
  const current = readHolder();
  if (current && current.pid !== expected?.pid) return false;
  fs.rmSync(lockPath(), { force: true });
  return true;
}

export function acquireInstanceLock(probe: ProcessProbe = defaultProbe): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (tryCreate()) return;
    const holder = readHolder();
    if (
      holder &&
      holder.pid !== process.pid &&
      probe.isAlive(holder.pid) &&
      probe.isBotProcess(holder.pid)
    ) {
      throw new InstanceLockHeldError(holder);
    }
    if (!removeIfHolder(holder)) return;
  }
  throw new Error(`failed to acquire instance lock at ${lockPath()}`);
}

export function releaseInstanceLock(): void {
  const holder = readHolder();
  if (holder?.pid !== process.pid) return;
  try {
    fs.rmSync(lockPath(), { force: true });
  } catch {
    // best-effort
  }
}
