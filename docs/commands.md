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
| `/run [session] <cmd>` | Whitelisted command + Enter | ✅ |
| `/sessions` | None (lists all tmux sessions) | - |

## Text (no `/` prefix)

| Message received | Sent to tmux | Note |
|------------------|--------------|------|
| `claude-stella ...` | `claude-stella ...` + Enter | Whitelisted |
| Any other text | None | Replies with usage |

## Whitelist (governs `/run` and text commands)

| Pattern | Matches |
|---------|---------|
| `/esc` | `/esc` |
| `/exit` | `/exit` |
| `/new` | `/new` |
| `/clear` | `/clear` |
| `/status` | `/status` |
| `claude(?:-[a-z]+)?\b` | `claude-stella`, `claude-code`, etc. |

## Additional Notes

- `[session]` argument: space-separated, e.g. `/exit my_session`; omit to use `TMUX_SESSION` from `.env`
- All commands to tmux automatically end with `C-m` (Enter)
- Max message length: `MAX_COMMAND_LENGTH` env var (default 5000)
- User rate limit: `RATE_LIMIT_MS` env var (default 2000ms)
- User allowlist: `ALLOWED_USER_IDS` env var (empty = no restriction)
- Startup command: `CLAUDE_STARTUP_COMMAND` env var (default `claude-stella --channels plugin:telegram@claude-plugins-official`)