# Telegram bridge second-factor implementation

Approved scope: lightweight Google Authenticator compatible TOTP, preserving existing
commands and tmux interaction. No external approval website or automatic host changes.

- [x] Add a tested authorization module: private-chat and user/session scopes,
  persistent OTP replay prevention and brute-force limits, expiring in-memory grants,
  immutable single-use removal approvals, and local revocation generations.
- [x] Add local interactive enrollment and recovery/reset commands. Store the secret
  only in the selected .env, show the QR locally, verify before saving, and protect
  local state with restrictive modes and atomic writes. No remote enrollment/reset.
- [x] Integrate authorization into every protected bot operation and queued execution.
  Discard old queues on secure startup; persist no authorization tokens. Filter sessions,
  scope session selections to user/chat, bind queued actions to pane identity, and send
  text literally rather than interpreting key names.
- [x] Update configuration, all command registries/help/docs and installation guidance.
  Explain OTP channel risks, active-grant risk, local-backend trust and host isolation.
- [x] Verify RFC TOTP vectors, replay across restart, guessing limits, scopes, expiry,
  revocation, approvals, unconfigured fail-closed behavior, and handler bypass cases.
  Run the full suite, build, lint, type checks and dependency audit.

Implementation follows test-first checks in the current feature branch. Existing
commands remain available after authorization. Configuration changes and enrollment
require local access; enrollment is never performed automatically on the user's machine.
