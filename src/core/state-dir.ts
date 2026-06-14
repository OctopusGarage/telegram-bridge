import { homedir } from "node:os";
import * as path from "node:path";

/**
 * Low-level primitive: explicit state dir override, or the fallback path.
 */
export function stateDir(fallback: string): string {
  return process.env.TGB_STATE_DIR ?? fallback;
}

/**
 * Default bot state root under user home when not overridden.
 */
const DEFAULT_STATE_DIR = path.join(homedir(), ".telegram-bridge");

/**
 * Single source of truth for writable bot state files.
 */
export function appStateDir(): string {
  return stateDir(DEFAULT_STATE_DIR);
}

/**
 * Path to a state file under {@link appStateDir}.
 */
export function appStateFile(name: string): string {
  return path.join(appStateDir(), name);
}
