import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type SecurityState = {
  version: 1;
  generation: string;
  lastCounter: number;
  failures: number;
  blockedUntil: number;
  suspended: boolean;
  secretFingerprint: string | null;
};

export function privateDirectory(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink())
    throw new Error("Security directory must not be a symlink");
  fs.chmodSync(dir, 0o700);
}

export function atomicPrivateWrite(file: string, content: string): void {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error("Security file must not be a symlink");
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

// Synchronous critical sections serialize OTP use and local revocation across processes.
// A leftover lock after a crash deliberately fails closed; the local CLI can repair it.
export function withSecurityState<T>(file: string, update: (state: SecurityState) => T): T {
  privateDirectory(path.dirname(file));
  const lock = `${file}.lock`;
  const fd = fs.openSync(lock, "wx", 0o600);
  try {
    let state: SecurityState;
    const existed = fs.existsSync(file);
    if (existed) {
      if (fs.lstatSync(file).isSymbolicLink())
        throw new Error("Security state must not be a symlink");
      fs.chmodSync(file, 0o600);
      state = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (
        state.version !== 1 ||
        typeof state.generation !== "string" ||
        !Number.isSafeInteger(state.lastCounter) ||
        !Number.isSafeInteger(state.failures) ||
        state.failures < 0 ||
        !Number.isFinite(state.blockedUntil) ||
        typeof state.suspended !== "boolean" ||
        !(state.secretFingerprint === null || typeof state.secretFingerprint === "string")
      )
        throw new Error("Invalid security state; recover locally");
    } else {
      state = {
        version: 1,
        generation: randomUUID(),
        lastCounter: -1,
        failures: 0,
        blockedUntil: 0,
        suspended: false,
        secretFingerprint: null,
      };
    }
    const before = JSON.stringify(state);
    const result = update(state);
    const after = JSON.stringify(state);
    if (!existed || before !== after) atomicPrivateWrite(file, after);
    return result;
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

export function revokeSecurityState(file: string): void {
  withSecurityState(file, (state) => {
    state.generation = randomUUID();
    state.suspended = true;
  });
}

export function resumeSecurityState(file: string): void {
  withSecurityState(file, (state) => {
    if (!state.secretFingerprint)
      throw new Error("Enroll an authenticator locally before resuming");
    state.generation = randomUUID();
    state.suspended = false;
  });
}
