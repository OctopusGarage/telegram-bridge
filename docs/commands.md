# telegram-bridge Command Reference

## Commands (prefixed with `/`, routed by gramY)

| Command | What it sends to tmux | Supports session |
|---------|-----------------------|:---:|
| `/help` | None (replies with help info) | - |
| `/peek [session]` | None (captures and replies with pane text) | ✅ |
| `/esc [session]` | Escape key (not text) | ✅ |
| `/enter [session]` | Enter key (not text) | ✅ |
| `/interrupt [session]` | Ctrl-C (not text) | ✅ |
| `/up [session]` | Up arrow (not text) | ✅ |
| `/down [session]` | Down arrow (not text) | ✅ |
| `/exit [session]` | `/exit` + Enter | ✅ |
| `/clear [session]` | `/clear` + Enter | ✅ |
| `/new [session]` | `/new` + Enter | ✅ |
| `/run [session] <cmd>` | `<cmd>` + Enter (must match `ALLOWED_RUN_PATTERNS`) | ✅ |
| `/cwd <path>` | `cd <path> && pwd` + Enter (restricted to allowed roots) | - |
| `/list_recent_workdir` | None (replies with numbered list + /cwd_<n>) | - |
| `/attach <n>` | Switches tmux session by number (persisted to `.current_tmux_session`) | - |
| `/remove <n>` | Removes tmux session by number | - |
| `/cwd_<n>` | `cd <dir[n]> && pwd` + Enter (from recent list) | - |
| `/sessions` | None (lists numbered sessions, current pinned with ✅) | - |
| `/attach_<n>` | Switches tmux session by number | - |
| `/remove_<n>` | Removes tmux session by number | - |

## Text (no `/` prefix)

| Message received | Sent to tmux | Note |
|------------------|--------------|------|
| any text | the text + Enter | Must match `ALLOWED_RUN_PATTERNS` (same gate as `/run`) |

## Allowlist (governs `/run` and free-form text)

`ALLOWED_RUN_PATTERNS` is a comma-separated list of regular expressions. Each is
auto-anchored (`^(?:…)$`) and matched case-insensitively against the whole command.

- **Empty = deny all** (fail closed) — no free-form command runs until configured.
- Example: `claude(-[a-z]+)?` allows `claude`, `claude-stella`, `claude-code` (no extra args).
- Example: `npm run [a-z:]+, git status` allows those two command shapes.

> Caveat: entries are split on commas, so avoid `{m,n}` regex quantifiers in a pattern (use `+`/`*`/character classes instead).

## Additional Notes

- `[session]` argument: space-separated, e.g. `/exit my_session`; omit to use session from `.current_tmux_session` (fallback order: argument → saved session → `TMUX_SESSION` from `.env`, default `telegram_tmux_session`)
- Session creation: only the **default** session is auto-created (`tmux new-session -d`) on demand when no existing session is specified. An explicitly-named session (arg or saved current session) that doesn't exist is **not** created — it falls back to the default.
- `.current_tmux_session`: file in bot directory that persists the current tmux session across restarts
- All commands to tmux automatically end with `C-m` (Enter)
- Max message length: `MAX_COMMAND_LENGTH` env var (default 5000)
- User rate limit: `RATE_LIMIT_MS` env var (default 2000ms)
- User allowlist: `ALLOWED_USER_IDS` env var. Fail closed — when empty, all users are denied unless `ALLOW_ALL_USERS=true` is explicitly set.
- Allowed `/run` commands: `ALLOWED_RUN_PATTERNS` env var (comma-separated regexes, auto-anchored, case-insensitive; empty = deny all)
- `/cwd` allowed roots: `ALLOWED_CWD_ROOTS` env var (comma-separated, e.g. `~/programming,~/code`)