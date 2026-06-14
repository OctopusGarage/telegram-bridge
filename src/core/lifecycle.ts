import * as fs from "node:fs";
import * as path from "node:path";

import { appStateFile } from "./state-dir.js";

const marker = (): string => appStateFile(".running");

export function detectUncleanRestart(): boolean {
  const markerPath = marker();
  let unclean = false;
  try {
    unclean = fs.existsSync(markerPath);
  } catch {
    unclean = false;
  }

  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, `${process.pid} ${new Date().toISOString()}\n`, "utf8");
  } catch {
    // best-effort marker
  }

  return unclean;
}

export function markCleanShutdown(): void {
  try {
    fs.rmSync(marker(), { force: true });
  } catch {
    // best-effort
  }
}
