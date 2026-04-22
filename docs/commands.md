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
| `/startup [session]` | `claude-stella --channels plugin:telegram@claude-plugins-official` + Enter | ✅ |
| `/startup_continue [session]` | `claude-stella --channels plugin:telegram@claude-plugins-official --continue` + Enter | ✅ |
| `/run <cmd>` | `claude-<name>` (no extra args) + Enter | - |
| `/cwd <path>` | `cd <path> && pwd` + Enter (restricted to allowed roots) | - |
| `/list_recent_workdir` | None (replies with numbered list + /cwd_<n>) | - |
| `/attach <n>` | Switches tmux session by number (persisted to `.current_tmux_session`) | - |
| `/cwd_<n>` | `cd <dir[n]> && pwd` + Enter (from recent list) | - |
| `/sessions` | None (lists numbered sessions, current pinned with ✅) | - |
| `/attach_<n>` | Switches tmux session by number | - |

## Text (no `/` prefix)

| Message received | Sent to tmux | Note |
|------------------|--------------|------|
| `claude-<name>` | `claude-<name>` + Enter | Whitelisted, no args |

## Whitelist (governs `/run` and text commands)

| Pattern | Matches |
|---------|---------|
| `claude(?:-[a-z]+)?$` | `claude-stella`, `claude-code` (no extra args) |

## Additional Notes

- `[session]` argument: space-separated, e.g. `/exit my_session`; omit to use session from `.current_tmux_session` (fallback order: argument → saved session → `TMUX_SESSION` from `.env`)
- `.current_tmux_session`: file in bot directory that persists the current tmux session across restarts
- All commands to tmux automatically end with `C-m` (Enter)
- Max message length: `MAX_COMMAND_LENGTH` env var (default 5000)
- User rate limit: `RATE_LIMIT_MS` env var (default 2000ms)
- User allowlist: `ALLOWED_USER_IDS` env var (empty = no restriction)
- Startup command: `CLAUDE_STARTUP_COMMAND` env var (default `claude-stella --channels plugin:telegram@claude-plugins-official`)
- `/cwd` allowed roots: `ALLOWED_CWD_ROOTS` env var (comma-separated, e.g. `~/programming,~/code`)