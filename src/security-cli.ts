import "./config.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";
import { resetEnrollment, saveEnrollment } from "./auth/enrollment.js";
import { resumeSecurityState, revokeSecurityState, withSecurityState } from "./auth/state.js";
import { appStateFile } from "./core/state-dir.js";

const envFile = path.resolve(process.env.TGB_ENV_FILE?.trim() || ".env");
const statePath = appStateFile("security/state.json");
const action = process.argv[2];

try {
  if (action === "revoke") {
    revokeSecurityState(statePath);
    console.log(
      "Remote terminal access suspended. Pending and active authorizations are invalid. Use security resume locally to re-enable verification.",
    );
  } else if (action === "resume") {
    resumeSecurityState(statePath);
    console.log("Verification re-enabled. All users must unlock again.");
  } else if (action === "status") {
    const status = withSecurityState(statePath, (state) => ({
      suspended: state.suspended,
      enrolled: state.secretFingerprint !== null,
      verificationLocked: state.blockedUntil > Date.now(),
    }));
    console.log(JSON.stringify(status, null, 2));
  } else if (action === "setup" || action === "reset" || action === "repair-lock") {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error("Run this command in an interactive local terminal");
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (action === "repair-lock") {
        const answer = await terminal.question(
          "Stop the bot and all security CLI processes first. Type REPAIR to remove a stale security lock: ",
        );
        if (answer !== "REPAIR") throw new Error("Cancelled");
        fs.rmSync(`${statePath}.lock`, { force: true });
        revokeSecurityState(statePath);
        console.log(
          "Stale lock removed; remote access remains suspended. Use security resume after inspection.",
        );
      } else if (action === "reset") {
        const answer = await terminal.question(
          "Type RESET to remove the authenticator and suspend remote access: ",
        );
        if (answer !== "RESET") throw new Error("Cancelled");
        resetEnrollment(envFile, statePath);
        console.log(
          "Authenticator removed. Run security setup, then restart the bot. Remove the old entry from your phone.",
        );
      } else {
        if (process.env.TOTP_SECRET)
          throw new Error("Authenticator already configured; reset locally first");
        const secret = new Secret({ size: 20 });
        const totp = new TOTP({
          issuer: "Telegram Bridge",
          label: "terminal access",
          secret,
          digits: 6,
          period: 30,
        });
        console.log(
          "Scan this QR in Google Authenticator or another TOTP app. Keep it private; it contains the enrollment key.",
        );
        console.log(await QRCode.toString(totp.toString(), { type: "terminal", small: true }));
        const code = (
          await terminal.question("Enter the current six-digit code to finish enrollment: ")
        ).trim();
        saveEnrollment({ envFile, statePath, secret: secret.base32, code });
        console.log(
          "Enrollment saved to the selected .env with owner-only permissions. Restart the bot, then use /unlock. Wait for the next code before approving.",
        );
      }
    } finally {
      terminal.close();
    }
  } else {
    throw new Error("Usage: security <setup|status|revoke|resume|reset|repair-lock>");
  }
} catch {
  // Never print arbitrary errors from libraries that might include enrollment material.
  console.error(
    "Security command failed. Check the command, local file permissions, lock state, enrollment and verification code. Setup requires an interactive terminal and reset before replacement.",
  );
  process.exitCode = 1;
}
