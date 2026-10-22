import type { DeniedAttempt } from "./authorization.js";

const THRESHOLD = 5;
const WINDOW_MS = 10 * 60_000;
const COOLDOWN_MS = 10 * 60_000;
const REASONS: Record<DeniedAttempt["reason"], string> = {
  identity: "User is not allowed",
  "private-chat": "Private chat required",
  session: "Session is not allowed",
  authorization: "Terminal authorization denied",
  verification: "Authenticator verification denied",
  approval: "Approval request denied",
};

type AlertOptions = {
  recipients: Iterable<string>;
  send: (recipient: string, text: string) => Promise<unknown>;
  now?: () => number;
};

/** Installation-wide, bounded counting; notification failures never affect authorization. */
export class SecurityAlerts {
  private attempts: number[] = [];
  private nextAlertAt = 0;
  private readonly recipients: string[];
  private readonly now: () => number;

  constructor(private readonly options: AlertOptions) {
    this.recipients = [...new Set(options.recipients)];
    this.now = options.now ?? Date.now;
  }

  async record(attempt: DeniedAttempt): Promise<void> {
    const now = this.now();
    if (now < this.nextAlertAt) return;
    this.attempts = this.attempts.filter((timestamp) => timestamp > now - WINDOW_MS);
    this.attempts.push(now);
    if (this.attempts.length < THRESHOLD) return;

    // Reserve before awaiting Telegram, so concurrent denials cannot flood alerts.
    this.attempts = [];
    this.nextAlertAt = now + COOLDOWN_MS;
    const userId = /^\d{1,20}$/.test(attempt.userId) ? attempt.userId : "unknown";
    const text =
      `⚠️ Security warning: ${THRESHOLD} denied access attempts within 10 minutes.\n` +
      `Latest user ID: ${userId}\nReason: ${REASONS[attempt.reason]}\n` +
      "Use /lock to revoke your authorizations. If unexpected, run " +
      "telegram-bridge security revoke on your computer and review your Telegram login sessions.\n" +
      "Alerts are limited to one per 10 minutes.";

    await Promise.all(
      this.recipients.map(async (recipient) => {
        try {
          await this.options.send(recipient, text);
        } catch {
          // Telegram error objects can contain sensitive API request details.
          console.warn("[security] Could not deliver a security warning to a configured user.");
        }
      }),
    );
  }
}
