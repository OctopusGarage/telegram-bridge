# telegram-bridge command reference

Use a private chat from an explicitly allowed Telegram user ID. Every terminal input,
pane capture, directory/history operation and queue-status request needs a current grant.

| Command | Behavior | Second factor |
|---------|----------|---------------|
| `/help` | Show command usage | No |
| `/unlock [session]` | Request access; receive details, a `/lock` reminder and a separate approval command to copy | Creates approval request |
| `/approve <request-id> <code>` | Verify a six-digit TOTP for the exact request | Single use |
| `/lock` | Revoke your grants and pending approval | No |
| `/peek [session]` | Capture pane text | Session grant |
| `/esc [session]` | Send Escape | Session grant |
| `/enter [session]` | Send Enter | Session grant |
| `/interrupt [session]` | Send Ctrl-C | Session grant |
| `/up [session]` | Send Up | Session grant |
| `/down [session]` | Send Down | Session grant |
| `/exit [session]` | Send `/exit` + Enter | Session grant and command allowlist |
| `/clear [session]` | Send `/clear` + Enter | Session grant and command allowlist |
| `/new [session]` | Send `/new` + Enter | Session grant and command allowlist |
| `/run [session] <cmd>` | Send allowed text literally, then Enter | Session grant and command allowlist |
| `/cwd <path>` | Send quoted `cd <path> && pwd` | Session grant and allowed roots |
| `/list_recent_workdir` | Show allowed recent directories with `/cwd_<n>` | Session grant |
| `/clear_recent_workdir` | Clear recent directory history | Session grant |
| `/cwd_<n>` | Switch to an allowed recent directory | Session grant and allowed roots |
| `/queue_status` | Show the selected session's queued/running work and previews | Session grant |
| `/sessions` | List only allowed sessions and their shortcuts | No |
| `/attach <hash or n>` | Select an allowed session | No; selection does not unlock it |
| `/attach_<hash or n>` | Same selection shortcut | No |
| `/remove <hash or n>` | Request deletion of the exact allowed session | Separate approval, even when unlocked |
| `/remove_<hash or n>` | Same removal shortcut | Separate approval |

Session hashes are six-character identifiers shown by `/sessions`; legacy numeric indexes
are also accepted. They identify sessions and are not authorization credentials.
`[session]` defaults to your saved user/chat selection, then `TMUX_SESSION`. `/run` explicitly
recognizes the configured default session; use `/attach` to select another allowed target.
An explicitly selected missing session is rejected instead of falling back to another target.
Only the configured default session can be created on demand after authorization.

Plain text is echoed with `/run` guidance and is not sent to tmux. A bare OTP is not approved
or executed. Unknown slash commands are ignored. Named key commands remain available after
unlocking, including for interactive CLI menus; they have the same security scope as text.

## Command policy

`ALLOWED_RUN_PATTERNS` is a comma-separated list of regular expressions. Each is anchored
to the entire command and matched case-insensitively. Empty means deny all `/run` and
text-command input. An authenticator grant never bypasses this policy.

- `claude(-[a-z]+)?` permits that CLI name family without additional arguments.
- `npm run [a-z:]+,git status` permits those command shapes.
- Entries split on commas: avoid `{m,n}` quantifiers.
- Broad expressions can admit shell syntax or dangerous arguments. A regex does not
  establish the safety of a shell command, agent prompt or program behavior.

`ALLOWED_CWD_ROOTS` limits `/cwd` and recent-directory switching, including resolved symlinks.
It does not sandbox running commands. `/cwd` sends shell syntax; use it with a shell pane,
not an application expecting another input format.

## Authorization lifecycle

`AUTH_SESSION_TTL_SECONDS` defaults to 300 (range 30–900). Pending requests use
`AUTH_APPROVAL_TTL_SECONDS`, default 60 (range 15–120). Each new request replaces your
previous pending request. A consumed code cannot approve another request; use a fresh one.
Five failed verification attempts lock verification for five minutes across the installation.

Session removal binds the request to its target pane generation, revokes its grants,
cancels pending input and kills the session. Approval never grants general terminal access.
Terminal input is reauthorized before delivery. Locking/revoking cannot undo input already
delivered or terminate a running program. Restarting invalidates all grants and pending
approvals and discards saved terminal input.

`ALLOWED_TMUX_SESSIONS` defaults to `TMUX_SESSION` only. `TMUX_SOCKET` optionally selects a
named tmux server for all operations. `MAX_COMMAND_LENGTH` (default 5000), queue limits and
per-user/session/global rate limits still apply.

Local enrollment, emergency suspension and phone-loss recovery are documented in
[security.md](security.md). No Telegram command can reset or enroll the authenticator.
