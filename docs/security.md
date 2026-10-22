# Second-factor terminal authorization

Telegram Bridge keeps its terminal input, keys, pane capture and multi-session commands.
The local backend requires a Telegram user allowlist, a private chat, an allowed session,
and a short-lived authenticator grant before terminal access. MFA is enabled by default;
an installation without enrollment cannot control or read a terminal.

## Local enrollment

For a source checkout:

```bash
pnpm install
pnpm security setup
```

For an installed release:

```bash
telegram-bridge security setup
```

Run setup in a trusted local interactive terminal. Scan its QR with Google Authenticator
or any compatible TOTP app, then enter a current code to finish. The backend uses
six-digit SHA-1 TOTP with 30-second periods and at most one period of clock drift.
It verifies codes locally without a Google account API or external verification service.
Setup refuses replacement of an existing key and refuses noninteractive output. The QR
contains the secret: do not save screenshots, forward it, or expose your terminal to a
remote session you do not trust. Wait for a new code after setup; its code is already used.

The secret is stored only as `TOTP_SECRET` in the selected `.env`, with mode `0600`.
Set `TGB_ENV_FILE` consistently for both bot and CLI when using another configuration.
Use the same `TGB_STATE_DIR` for both; blank means the normal home state directory.
Restart the backend after enrollment/reset. Do not commit configuration or use another
service's TOTP secret. One installation has one authenticator key: all configured user IDs
are trusted operators of that same key. This is not a multi-tenant identity system.

## Telegram workflow

1. Send `/unlock [session]`. The bot describes the target and authorization duration in
   one message, followed by a separate approval command you can copy and edit.
2. Check the request, then send `/approve <request-id> <six-digit-code>`.
3. Use the existing commands normally. Authorization applies only to that user, private
   chat, session and pane generation. Each configured session requires its own unlock.
4. Send `/lock` to revoke your grants and pending approval. Queued actions with those
   grants are rejected. Already delivered input and running programs are not undone.

Default grants last five minutes; configure `AUTH_SESSION_TTL_SECONDS` from 30 to 900.
Help, the filtered session list, selecting a permitted session and locking do not require
a grant. Pane output, directory history, queue status and every terminal write do.
Session selections are stored separately for each user/chat. Plain messages are echoed;
use `/run` for approved command text. A bare six-digit message is never an approval.

`/remove`, including its shortcut, always creates a separate removal request, even during
an unlocked session. Approval binds its immutable target, request ID and pane generation,
expires after 60 seconds by default, and is consumed once. Successful removal revokes
session grants and cancels queued input before killing the session. Changing the target
requires a new request. The latest request replaces that user's prior pending request.

The backend records used TOTP counters and verification failures in owner-only local state,
atomically guarded against concurrent verification. Codes cannot be reused after restart.
Five incorrect/replayed codes cause a five-minute verification lock across the installation.
This global limit prevents guessing across user IDs; it also means a compromised allowed
account can temporarily deny verification. Unknown requests do not consume guesses.
Use the next fresh code when a prior code was used, including for a separate operation.

Approval messages are deleted on a best-effort basis and codes are never echoed or put
in the execution queue. Deletion does not guarantee removal from Telegram, notifications
or other logged-in devices. If deletion fails, manually remove the message.
Bare six-digit messages also receive best-effort deletion and are not echoed.

## Revocation and recovery

Source checkout commands (installed releases use `telegram-bridge security` instead):

```bash
pnpm security status
pnpm security revoke
pnpm security resume
pnpm security reset
pnpm security setup
```

`revoke` persistently suspends terminal authorization, invalidates all grants and pending
approvals, and is checked by a live backend at its next authorization check. `resume`
allows fresh verification; it never revives old grants. Neither command terminates a
program that already received input. Stop the service/affected program if needed.
After a reset, `resume` cannot re-enable the removed key; complete a fresh setup first.

If the phone is lost or its key compromised, use local `reset`, enroll a new authenticator,
then restart the bot. Reset suspends a live backend before removing the key. A running
backend with a replaced key cannot authorize with the old secret. There is no Telegram
command to enroll, reset, resume a local suspension or change security policy. Recovery
depends on trusted local access; no recovery code or key is sent through Telegram.

Grants and pending approvals exist only in memory. Restarting locks all sessions and
discards persisted terminal actions instead of replaying them without fresh authorization.
This deliberately changes crash-recovery behavior for input. User selections remain saved.

Security files use atomic replacement and owner-only modes. A crash in the short state
update critical section can leave a lock; verification then fails closed. Stop the bot
and every security CLI process, run `pnpm security repair-lock` in a local terminal,
inspect the state and use `resume` before restarting. Do not repair a live lock or delete
security state: deleting state loses used-code history and local suspension.

## Session scope and command policy

`ALLOWED_TMUX_SESSIONS` limits every terminal target, session listing, attachment and
removal. Empty means only `TMUX_SESSION`. Names must match exactly. `TMUX_SOCKET` optionally
selects an independent tmux server; all bridge operations use that server. Existing users
can leave it empty to keep their existing server. For stronger separation, create a named
server and include only its intended sessions. Independent sockets are supported by
the [tmux manual](https://man.openbsd.org/tmux.1).

`ALLOWED_RUN_PATTERNS` remains an additional whole-command allowlist, denied when empty.
Use narrow expressions. Patterns such as `.*` or `tool .*` may admit shell separators,
substitutions, dangerous flags or prompts: matching a regex is not a shell safety proof.
`ALLOWED_CWD_ROOTS` restricts directory-switch commands, not the program's filesystem
permissions. Text is sent literally to tmux; named key commands are separate operations.

Authorization is checked both before enqueue and before delivery. Queue entries bind
their original grant and pane identity. A revoked, expired or replaced grant, missing
security metadata, changed pane, or no-longer-allowed `/run` command rejects delivery.

## Threat boundary

This lightweight design protects against a stolen Telegram session **when the attacker
does not also control the authenticator or local backend**. It cannot distinguish you
from an attacker using the same Telegram account during an active grant. OTPs entered in
Telegram can be stolen/relayed live; request binding and single-use checks reduce accidental
approval and replay, but TOTP does not cryptographically sign the operation. It is not
phishing-resistant. See [Google's authenticator documentation](https://support.google.com/accounts/answer/1066447)
and [NIST's OTP guidance](https://pages.nist.gov/800-63-4/sp800-63b.html).

Keys such as Up/Enter can replay shell history or confirm an agent's tool call. The bridge
therefore protects whole interactive sessions; it cannot reliably classify the consequences
of each keystroke, shell expression or AI prompt. Only explicit bridge session removal
has operation-specific approval. A destructive command within an unlocked terminal can
still run if terminal/application policy permits it.

The backend, its code, configuration and OS account remain trusted. MFA cannot protect a
computer already compromised under that account: it can read the shared secret, replace
the backend or access tmux directly. File permissions protect other users, not malicious
programs running as the same user.
The backend strips `BOT_TOKEN` and `TOTP_SECRET` from its tmux child environment, so it
does not automatically give a newly created server or pane those credentials. This does
not stop a same-user terminal from reading the backend's `.env` or other process state.

For meaningful host protection, run the bot, tmux and CLI under a dedicated low-privilege
account or in a VM. Restrict available project files, credentials, agent forwarding and
network access; avoid mounting the full home directory or privileged control sockets.
Use application tool approval/sandboxing too. When a pane should only run an agent, launch
it with `exec <agent-command>` in place of an interactive shell so agent exit closes the
pane instead of exposing a shell. A separate tmux socket or working directory alone is
not OS isolation. These deployment changes are intentionally not performed automatically.
