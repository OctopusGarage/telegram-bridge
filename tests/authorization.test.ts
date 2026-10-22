import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Secret, TOTP } from "otpauth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Authorization } from "../src/auth/authorization.js";
import { resumeSecurityState, withSecurityState } from "../src/auth/state.js";

const secret = Secret.fromUTF8("12345678901234567890").base32;
const principal = { userId: "7", chatId: "7" };
const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bridge-auth-"));
  dirs.push(dir);
  let now = 59_000;
  const options = {
    secret,
    statePath: join(dir, "security", "state.json"),
    allowedUserIds: new Set(["7", "8"]),
    allowedSessions: ["work", "dev"],
    grantTtlMs: 60_000,
    approvalTtlMs: 30_000,
    now: () => now,
    onDenied: vi.fn(),
  };
  const otp = () =>
    new TOTP({ secret: Secret.fromBase32(secret), digits: 6 }).generate({ timestamp: now });
  return {
    auth: new Authorization(options),
    options,
    otp,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("authorization", () => {
  it("reports denied terminal access and failed verification without exposing the code", () => {
    const f = fixture();
    expect(() => f.auth.authorize(principal, "work")).toThrow(/locked/i);
    expect(f.options.onDenied).toHaveBeenLastCalledWith({ ...principal, reason: "authorization" });
    const request = f.auth.request(principal, "unlock", "work");
    expect(() => f.auth.confirm(principal, request.id, "private-otp-input")).toThrow();
    expect(f.options.onDenied).toHaveBeenLastCalledWith({ ...principal, reason: "verification" });
    expect(JSON.stringify(f.options.onDenied.mock.calls)).not.toContain("private-otp-input");
    f.auth.confirm(principal, request.id, f.otp());
    f.auth.authorize(principal, "work");
    expect(f.options.onDenied).toHaveBeenCalledTimes(2);
  });

  it("keeps access denied when the notification callback fails", () => {
    const f = fixture();
    f.options.onDenied.mockImplementation(() => {
      throw new Error("notification unavailable");
    });
    expect(() => f.auth.authorize(principal, "work")).toThrow(/locked/i);
  });
  it("accepts the six-digit RFC SHA-1 vector at 59 seconds", () => {
    const f = fixture();
    const request = f.auth.request(principal, "unlock", "work");
    f.auth.confirm(principal, request.id, "287082");
    expect(f.auth.authorize(principal, "work")).toBeTruthy();
  });
  it("fails closed without enrollment, a private chat, an allowed identity or session", () => {
    const f = fixture();
    expect(() =>
      new Authorization({ ...f.options, secret: undefined }).request(principal, "unlock", "work"),
    ).toThrow(/enroll/i);
    expect(() => f.auth.request({ userId: "9", chatId: "9" }, "unlock", "work")).toThrow(/denied/i);
    expect(() => f.auth.request({ userId: "7", chatId: "-1" }, "unlock", "work")).toThrow(
      /private/i,
    );
    expect(() => f.auth.request(principal, "unlock", "other")).toThrow(/session/i);
    expect(() => f.auth.authorize(principal, "work")).toThrow(/unlock/i);
  });
  it("grants only the requested user, chat and session, and expires", () => {
    const f = fixture();
    const request = f.auth.request(principal, "unlock", "work");
    f.auth.confirm(principal, request.id, f.otp());
    const grant = f.auth.authorize(principal, "work");
    expect(grant).toBeTruthy();
    expect(() => f.auth.authorize(principal, "dev")).toThrow();
    expect(() => f.auth.authorize({ userId: "8", chatId: "8" }, "work")).toThrow();
    f.advance(60_001);
    expect(() => f.auth.authorize(principal, "work", grant)).toThrow();
  });
  it("rejects OTP replay even after restarting the service", () => {
    const f = fixture();
    f.auth.confirm(principal, f.auth.request(principal, "unlock", "work").id, f.otp());
    const restarted = new Authorization(f.options);
    expect(() =>
      restarted.confirm(principal, restarted.request(principal, "unlock", "work").id, f.otp()),
    ).toThrow(/invalid|used/i);
    expect(() => restarted.authorize(principal, "work")).toThrow();
    f.advance(30_000);
    restarted.confirm(principal, restarted.request(principal, "unlock", "work").id, f.otp());
    expect(restarted.authorize(principal, "work")).toBeTruthy();
  });
  it("locks guessing persistently and never accepts expired or replaced requests", () => {
    const f = fixture();
    const first = f.auth.request(principal, "unlock", "work");
    const second = f.auth.request(principal, "unlock", "dev");
    expect(() => f.auth.confirm(principal, first.id, f.otp())).toThrow(/request/i);
    for (let n = 0; n < 5; n++) expect(() => f.auth.confirm(principal, second.id, "bad")).toThrow();
    const restarted = new Authorization(f.options);
    expect(() =>
      restarted.confirm(principal, restarted.request(principal, "unlock", "dev").id, f.otp()),
    ).toThrow(/locked/i);
    f.advance(300_001);
    const request = restarted.request(principal, "unlock", "work");
    f.advance(30_001);
    expect(() => restarted.confirm(principal, request.id, f.otp())).toThrow(/expired/i);
  });
  it("binds removal to its immutable target and grants no general access", () => {
    const f = fixture();
    const request = f.auth.request(principal, "remove", "work", "pane-generation");
    const approved = f.auth.confirm(principal, request.id, f.otp());
    expect(approved).toMatchObject({ kind: "remove", session: "work", target: "pane-generation" });
    expect(() => f.auth.confirm(principal, request.id, f.otp())).toThrow();
    expect(() => f.auth.authorize(principal, "work")).toThrow();
    f.auth.consumeApproval(principal, approved);
    expect(() => f.auth.consumeApproval(principal, approved)).toThrow();
  });
  it("revokes or expires removal approvals before their delayed execution", () => {
    const f = fixture();
    const approved = f.auth.confirm(
      principal,
      f.auth.request(principal, "remove", "work", "pane").id,
      f.otp(),
    );
    f.auth.lock(principal);
    expect(() => f.auth.consumeApproval(principal, approved)).toThrow();
    f.advance(30_000);
    const second = f.auth.confirm(
      principal,
      f.auth.request(principal, "remove", "work", "pane").id,
      f.otp(),
    );
    f.advance(30_001);
    expect(() => f.auth.consumeApproval(principal, second)).toThrow(/expired/i);
  });
  it("local revocation invalidates existing grants and pending approvals", () => {
    const f = fixture();
    f.auth.confirm(principal, f.auth.request(principal, "unlock", "work").id, f.otp());
    const grant = f.auth.authorize(principal, "work");
    const pending = f.auth.request(principal, "remove", "work", "pane");
    f.auth.revokeAll();
    expect(() => f.auth.authorize(principal, "work", grant)).toThrow();
    expect(() => f.auth.request(principal, "unlock", "work")).toThrow(/suspend/i);
    f.advance(30_000);
    expect(() => f.auth.confirm(principal, pending.id, f.otp())).toThrow();
    expect(statSync(f.options.statePath).mode & 0o777).toBe(0o600);
    resumeSecurityState(f.options.statePath);
    expect(f.auth.request(principal, "unlock", "work")).toBeTruthy();
  });
  it("rejects a running backend's old key after local re-enrollment", () => {
    const f = fixture();
    const request = f.auth.request(principal, "unlock", "work");
    withSecurityState(f.options.statePath, (state) => {
      state.secretFingerprint = "changed";
    });
    expect(() => f.auth.confirm(principal, request.id, f.otp())).toThrow(/restart|changed/i);
  });
  it("binds interactive access to the approved pane generation", () => {
    const f = fixture();
    const request = f.auth.request(principal, "unlock", "work", "original-pane");
    f.auth.confirm(principal, request.id, f.otp());
    expect(f.auth.authorize(principal, "work", undefined, "original-pane")).toBeTruthy();
    expect(() => f.auth.authorize(principal, "work", undefined, "replacement-pane")).toThrow(
      /pane/i,
    );
  });
});
