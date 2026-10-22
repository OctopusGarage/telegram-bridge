import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExecFileLike, TmuxTarget } from "../types.js";

const execFileAsync = promisify(execFile);

export function tmuxEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  delete env.BOT_TOKEN;
  delete env.TOTP_SECRET;
  return env;
}

function defaultExecFile(file: string, args: string[]) {
  return execFileAsync(file, args, { env: tmuxEnvironment() });
}

export class TmuxBridge {
  private readonly execFile: ExecFileLike;
  private readonly target: TmuxTarget;
  private readonly socket?: string;

  constructor(options: { execFile?: ExecFileLike; target: TmuxTarget; socket?: string }) {
    this.execFile = options.execFile ?? defaultExecFile;
    this.target = options.target;
    this.socket = options.socket;
  }

  private run(args: string[]) {
    return this.execFile("tmux", this.socket ? ["-L", this.socket, ...args] : args);
  }

  private formatTarget(sessionName?: string): string {
    const session = sessionName ?? this.target.session;
    const { window, pane } = this.target;
    return `=${session}:${window}.${pane}`;
  }

  async ensurePaneExists(sessionName?: string): Promise<void> {
    const result = await this.run([
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
    await this.run(["send-keys", "-t", this.formatTarget(sessionName), "-l", "--", command]);
    await this.sendRawKey("Enter", sessionName);
  }

  // Send tmux key bindings directly (e.g. "C-c", "C-l", "Escape", "C-b")
  async sendRawKey(key: string, sessionName?: string): Promise<void> {
    await this.run(["send-keys", "-t", this.formatTarget(sessionName), key]);
  }

  async capturePane(sessionName?: string): Promise<string> {
    const result = await this.run([
      "capture-pane",
      "-p",
      "-J",
      "-t",
      this.formatTarget(sessionName),
    ]);
    return result.stdout;
  }

  async listSessions(): Promise<string> {
    const result = await this.run(["list-sessions"]);
    return result.stdout.trim();
  }

  async listSessionNames(): Promise<string[]> {
    const result = await this.run(["list-sessions"]);
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
    await this.run(["new-session", "-d", "-s", name]);
  }

  async killSession(name: string): Promise<void> {
    await this.run(["kill-session", "-t", `=${name}`]);
  }

  async paneIdentity(sessionName: string): Promise<string> {
    const result = await this.run([
      "display-message",
      "-p",
      "-t",
      this.formatTarget(sessionName),
      "#{pid}:#{session_id}:#{pane_id}:#{pane_pid}",
    ]);
    const identity = result.stdout.trim();
    if (!/^\d+:\$\d+:%\d+:\d+$/.test(identity)) throw new Error("Cannot identify target pane");
    return identity;
  }
}
