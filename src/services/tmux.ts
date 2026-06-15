import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExecFileLike, TmuxTarget } from "../types.js";

const execFileAsync = promisify(execFile);

function defaultExecFile(file: string, args: string[]) {
  return execFileAsync(file, args);
}

export class TmuxBridge {
  private readonly execFile: ExecFileLike;
  private readonly target: TmuxTarget;

  constructor(options: { execFile?: ExecFileLike; target: TmuxTarget }) {
    this.execFile = options.execFile ?? defaultExecFile;
    this.target = options.target;
  }

  private formatTarget(sessionName?: string): string {
    const session = sessionName ?? this.target.session;
    const { window, pane } = this.target;
    return `${session}:${window}.${pane}`;
  }

  async ensurePaneExists(sessionName?: string): Promise<void> {
    const result = await this.execFile("tmux", [
      "list-panes",
      "-t",
      this.formatTarget(sessionName),
      "-F",
      "#{pane_id}",
    ]);

    if (result.stdout.trim().length === 0) {
      throw new Error(`tmux pane not found: ${this.formatTarget()}`);
    }
  }

  async sendCommand(command: string, sessionName?: string): Promise<void> {
    await this.execFile("tmux", [
      "send-keys",
      "-t",
      this.formatTarget(sessionName),
      command,
      "C-m",
    ]);
  }

  // Send tmux key bindings directly (e.g. "C-c", "C-l", "Escape", "C-b")
  async sendRawKey(key: string, sessionName?: string): Promise<void> {
    await this.execFile("tmux", ["send-keys", "-t", this.formatTarget(sessionName), key]);
  }

  async capturePane(sessionName?: string): Promise<string> {
    const result = await this.execFile("tmux", [
      "capture-pane",
      "-p",
      "-J",
      "-t",
      this.formatTarget(sessionName),
    ]);
    return result.stdout;
  }

  async listSessions(): Promise<string> {
    const result = await this.execFile("tmux", ["list-sessions"]);
    return result.stdout.trim();
  }

  async listSessionNames(): Promise<string[]> {
    const result = await this.execFile("tmux", ["list-sessions"]);
    return result.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(":")[0]!);
  }

  async sessionExists(name: string): Promise<boolean> {
    const sessions = await this.listSessionNames();
    return sessions.includes(name);
  }

  // Create a detached session if it doesn't already exist (no-op if present).
  async ensureSession(sessionName?: string): Promise<void> {
    const name = sessionName ?? this.target.session;
    if (await this.sessionExists(name)) {
      return;
    }
    await this.execFile("tmux", ["new-session", "-d", "-s", name]);
  }

  async killSession(name: string): Promise<void> {
    await this.execFile("tmux", ["kill-session", "-t", name]);
  }
}
