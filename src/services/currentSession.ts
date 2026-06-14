import * as fs from "node:fs";
import * as path from "node:path";

import { appStateDir } from "../core/state-dir.js";

const CURRENT_SESSION_FILE = ".current_tmux_session";

function readSessionFile(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

export class CurrentSessionManager {
  private cache: string | null = null;
  private readonly filePath: string;
  private readonly fallbackLegacy: boolean;

  constructor(dir: string = appStateDir()) {
    this.filePath = path.join(dir, CURRENT_SESSION_FILE);
    this.fallbackLegacy = dir === appStateDir();
  }

  async get(): Promise<string | null> {
    if (this.cache !== null) return this.cache;
    let value = readSessionFile(this.filePath);
    if (value === null && this.fallbackLegacy) {
      value = readSessionFile(path.join(process.cwd(), CURRENT_SESSION_FILE));
      if (value !== null) {
        await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.promises.writeFile(this.filePath, value, "utf-8");
      }
    }
    this.cache = value;
    return this.cache;
  }

  async set(sessionName: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.writeFile(this.filePath, sessionName, "utf-8");
    this.cache = sessionName;
  }

  async clear(): Promise<void> {
    try {
      await fs.promises.unlink(this.filePath);
    } catch {
      // ignore if already gone
    }
    this.cache = null;
  }
}
