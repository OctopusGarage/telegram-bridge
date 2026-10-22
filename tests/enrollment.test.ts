import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Secret, TOTP } from "otpauth";
import { afterEach, expect, it } from "vitest";
import { Authorization } from "../src/auth/authorization.js";
import { resetEnrollment, saveEnrollment } from "../src/auth/enrollment.js";
import { resumeSecurityState } from "../src/auth/state.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bridge-enroll-"));
  dirs.push(dir);
  const envFile = join(dir, ".env"),
    statePath = join(dir, "security", "state.json");
  writeFileSync(envFile, "BOT_TOKEN=test\nALLOWED_USER_IDS=7\n");
  const secret = new Secret().base32;
  const now = 59_000;
  const code = new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp: now });
  return { envFile, statePath, secret, now, code };
}
it("verifies enrollment before saving and preserves unrelated configuration", () => {
  const f = fixture();
  expect(() => saveEnrollment({ ...f, code: "bad" })).toThrow(/invalid/i);
  expect(readFileSync(f.envFile, "utf8")).not.toContain("TOTP_SECRET");
  saveEnrollment(f);
  expect(readFileSync(f.envFile, "utf8")).toBe(
    `BOT_TOKEN=test\nALLOWED_USER_IDS=7\nTOTP_SECRET=${f.secret}\n`,
  );
  expect(statSync(f.envFile).mode & 0o777).toBe(0o600);
  expect(() => saveEnrollment(f)).toThrow(/already/i);
  const auth = new Authorization({
    secret: f.secret,
    statePath: f.statePath,
    allowedUserIds: new Set(["7"]),
    allowedSessions: ["work"],
    grantTtlMs: 60_000,
    approvalTtlMs: 60_000,
    now: () => f.now,
  });
  const p = { userId: "7", chatId: "7" };
  expect(() => auth.confirm(p, auth.request(p, "unlock", "work").id, f.code)).toThrow(/used/i);
});
it("local reset removes the key and suspends the still-running backend", () => {
  const f = fixture();
  saveEnrollment(f);
  resetEnrollment(f.envFile, f.statePath);
  expect(() => resumeSecurityState(f.statePath)).toThrow(/enroll/i);
  expect(readFileSync(f.envFile, "utf8")).not.toContain("TOTP_SECRET");
  expect(readFileSync(f.envFile, "utf8")).toContain("BOT_TOKEN=test");
  const auth = new Authorization({
    secret: f.secret,
    statePath: f.statePath,
    allowedUserIds: new Set(["7"]),
    allowedSessions: ["work"],
    grantTtlMs: 60_000,
    approvalTtlMs: 60_000,
  });
  expect(() => auth.request({ userId: "7", chatId: "7" }, "unlock", "work")).toThrow(/suspend/i);
});
