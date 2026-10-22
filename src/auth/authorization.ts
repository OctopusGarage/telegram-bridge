import { createHash, randomUUID } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { revokeSecurityState, withSecurityState } from "./state.js";

export type Principal = { userId: string; chatId: string };
type Request = Readonly<{
  id: string;
  kind: "unlock" | "remove";
  session: string;
  target?: string;
  expiresAt: number;
  generation: string;
}>;
type Grant = {
  id: string;
  session: string;
  expiresAt: number;
  generation: string;
  target?: string;
};
export type AuthorizationOptions = {
  secret?: string;
  statePath: string;
  allowedUserIds: Set<string>;
  allowedSessions: string[];
  grantTtlMs: number;
  approvalTtlMs: number;
  now?: () => number;
};

export class Authorization {
  private readonly requests = new Map<string, Request>();
  private readonly approvals = new Map<string, Request>();
  private readonly grants = new Map<string, Grant>();
  private readonly now: () => number;
  constructor(private readonly options: AuthorizationOptions) {
    this.now = options.now ?? Date.now;
  }

  private key(p: Principal): string {
    return `${p.userId}:${p.chatId}`;
  }

  checkIdentity(p: Principal, session?: string): void {
    if (!this.options.allowedUserIds.has(p.userId)) throw new Error("Access denied");
    if (!p.userId || p.chatId !== p.userId) throw new Error("Use a private chat with the bot");
    if (session !== undefined && !this.isSessionAllowed(session))
      throw new Error("Session not allowed");
  }

  isSessionAllowed(session: string): boolean {
    return this.options.allowedSessions.includes(session);
  }

  private generation(): string {
    return withSecurityState(this.options.statePath, (state) => {
      if (state.suspended) throw new Error("Remote access suspended locally");
      if (state.secretFingerprint && state.secretFingerprint !== this.fingerprint()) {
        throw new Error("Authenticator changed locally; restart the backend");
      }
      return state.generation;
    });
  }

  private fingerprint(): string {
    return createHash("sha256")
      .update(this.options.secret ?? "")
      .digest("hex");
  }

  request(p: Principal, kind: "unlock" | "remove", session: string, target?: string): Request {
    this.checkIdentity(p, session);
    if (!this.options.secret)
      throw new Error("Run security setup locally to enroll an authenticator");
    const request = Object.freeze({
      id: randomUUID().replaceAll("-", "").slice(0, 16),
      kind,
      session,
      target,
      expiresAt: this.now() + this.options.approvalTtlMs,
      generation: this.generation(),
    });
    this.requests.set(this.key(p), request);
    this.approvals.delete(this.key(p));
    return request;
  }

  confirm(p: Principal, requestId: string, code: string): Request {
    this.checkIdentity(p);
    const key = this.key(p);
    const request = this.requests.get(key);
    if (!request || request.id !== requestId) throw new Error("Approval request not found");
    this.checkIdentity(p, request.session);
    if (request.expiresAt <= this.now()) {
      this.requests.delete(key);
      throw new Error("Approval request expired");
    }
    if (!this.options.secret) throw new Error("Enroll an authenticator locally");
    const now = this.now();
    const totp = new TOTP({
      secret: Secret.fromBase32(this.options.secret),
      digits: 6,
      period: 30,
    });
    const error = withSecurityState(this.options.statePath, (state) => {
      if (state.suspended) return "Remote access suspended locally";
      if (state.secretFingerprint && state.secretFingerprint !== this.fingerprint()) {
        return "Authenticator changed locally; restart the backend";
      }
      if (state.generation !== request.generation) return "Approval request revoked";
      if (state.blockedUntil > now) return "Verification locked; try again in five minutes";
      const delta = /^\d{6}$/.test(code)
        ? totp.validate({ token: code, timestamp: now, window: 1 })
        : null;
      const counter = Math.floor(now / 30_000) + (delta ?? 0);
      if (delta === null || counter <= state.lastCounter) {
        state.failures += 1;
        if (state.failures >= 5) {
          state.blockedUntil = now + 300_000;
          state.failures = 0;
        }
        return "Invalid or already used verification code";
      }
      state.lastCounter = counter;
      state.secretFingerprint = this.fingerprint();
      state.failures = 0;
      state.blockedUntil = 0;
      return null;
    });
    if (error) throw new Error(error);
    this.requests.delete(key);
    if (request.kind === "unlock") {
      this.grants.set(`${key}:${request.session}`, {
        id: randomUUID(),
        session: request.session,
        expiresAt: now + this.options.grantTtlMs,
        generation: request.generation,
        target: request.target,
      });
    } else {
      this.approvals.set(key, request);
    }
    return request;
  }

  consumeApproval(p: Principal, request: Request): void {
    this.checkIdentity(p, request.session);
    const key = this.key(p);
    if (this.approvals.get(key) !== request)
      throw new Error("Approval revoked or already consumed");
    this.approvals.delete(key);
    if (request.expiresAt <= this.now()) throw new Error("Approval expired before execution");
    if (request.generation !== this.generation()) throw new Error("Authorization revoked locally");
  }

  authorize(p: Principal, session: string, expectedGrant?: string, target?: string): string {
    this.checkIdentity(p, session);
    const grant = this.grants.get(`${this.key(p)}:${session}`);
    if (
      !grant ||
      grant.expiresAt <= this.now() ||
      grant.generation !== this.generation() ||
      (expectedGrant !== undefined && expectedGrant !== grant.id)
    ) {
      throw new Error("Session locked. Use /unlock to verify with your authenticator");
    }
    if (target !== undefined) {
      if (grant.target !== undefined && grant.target !== target) {
        throw new Error("Target pane changed; unlock this session again");
      }
      grant.target = target;
    }
    return grant.id;
  }

  lock(p: Principal): void {
    this.checkIdentity(p);
    const prefix = `${this.key(p)}:`;
    for (const key of this.grants.keys()) if (key.startsWith(prefix)) this.grants.delete(key);
    this.requests.delete(this.key(p));
    this.approvals.delete(this.key(p));
  }

  lockSession(session: string): void {
    for (const [key, grant] of this.grants) if (grant.session === session) this.grants.delete(key);
    for (const [key, request] of this.requests)
      if (request.session === session) this.requests.delete(key);
    for (const [key, request] of this.approvals)
      if (request.session === session) this.approvals.delete(key);
  }

  revokeAll(): void {
    revokeSecurityState(this.options.statePath);
    this.grants.clear();
    this.requests.clear();
    this.approvals.clear();
  }
}
