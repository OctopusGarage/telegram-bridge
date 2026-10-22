import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { parse } from "dotenv";
import { Secret, TOTP } from "otpauth";
import { atomicPrivateWrite, revokeSecurityState, withSecurityState } from "./state.js";

const secretLine = /^(?:export\s+)?TOTP_SECRET\s*=.*(?:\r?\n|$)/gm;

function readEnv(file: string): string {
  try {
    if (fs.lstatSync(file).isSymbolicLink())
      throw new Error("Environment file must not be a symlink");
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

export function saveEnrollment(options: {
  envFile: string;
  statePath: string;
  secret: string;
  code: string;
  now?: number;
}): void {
  const { envFile, statePath, secret, code } = options;
  const now = options.now ?? Date.now();
  if (!/^[A-Z2-7]{32,128}$/.test(secret)) throw new Error("Invalid authenticator secret");
  const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 });
  const delta = /^\d{6}$/.test(code)
    ? totp.validate({ token: code, timestamp: now, window: 1 })
    : null;
  if (delta === null) throw new Error("Invalid verification code; enrollment was not saved");
  withSecurityState(statePath, (state) => {
    const current = readEnv(envFile);
    if (parse(current).TOTP_SECRET)
      throw new Error("Authenticator already enrolled; reset locally first");
    const clean = current.replace(secretLine, "");
    atomicPrivateWrite(
      envFile,
      `${clean}${clean && !clean.endsWith("\n") ? "\n" : ""}TOTP_SECRET=${secret}\n`,
    );
    state.generation = randomUUID();
    state.secretFingerprint = createHash("sha256").update(secret).digest("hex");
    state.lastCounter = Math.floor(now / 30_000) + delta;
    state.failures = 0;
    state.blockedUntil = 0;
    state.suspended = false;
  });
}

export function resetEnrollment(envFile: string, statePath: string): void {
  // Suspend first so a live backend holding the old key immediately loses authorization.
  revokeSecurityState(statePath);
  withSecurityState(statePath, (state) => {
    atomicPrivateWrite(envFile, readEnv(envFile).replace(secretLine, ""));
    state.secretFingerprint = null;
  });
}
