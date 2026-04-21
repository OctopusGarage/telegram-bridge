# Telegram Bridge

Telegram bot that forwards `/run <command>` requests into a configured tmux pane, then polls `tmux capture-pane` and streams back only new output.

## Prerequisites

- Node.js 24+
- `pnpm`
- `tmux` installed and available in `PATH`
- A Telegram bot token from BotFather
- An existing tmux session/window/pane that should receive commands

## Setup

```bash
pnpm install
cp .env.example .env
```

Fill `.env` with:

```dotenv
BOT_TOKEN=your-bot-token
TMUX_SESSION=telegram-bridge
TMUX_WINDOW=0
TMUX_PANE=0
POLL_INTERVAL_MS=1200
MAX_MESSAGE_LENGTH=3500
IDLE_POLL_TICKS=3
MAX_POLL_TICKS=20
HTTPS_PROXY=http://127.0.0.1:7890
# Comma-separated Telegram user IDs — leave empty to allow anyone (not recommended)
ALLOWED_USER_IDS=123456789,987654321
```

Example tmux target:

```bash
tmux new-session -d -s telegram-bridge
```

## Development

```bash
pnpm dev
```

## Production

```bash
pnpm build
pnpm start
```

## Commands

### `/run [session] <command>`
Send a command to tmux. Session name is optional; defaults to the one configured in `.env`.

| Example | session | command |
|---------|---------|---------|
| `/run claude_session /exit` | claude_session | `/exit` |
| `/run claude_session /esc` | claude_session | ESC key |
| `/run claude_session /enter` | claude_session | Enter key |
| `/run claude_session /interrupt` | claude_session | Ctrl-C |
| `/run claude_session /up` | claude_session | Up arrow |
| `/run claude_session /down` | claude_session | Down arrow |
| `/run claude_session /clear` | claude_session | `/clear` |
| `/run claude_session /new` | claude_session | `/new` |
| `/run claude_session /status` | claude_session | `/status` |
| `/run claude_session claude-stella --channels plugin:telegram --continue` | claude_session | `claude-stella --channels ...` |

### `/peek [session]`
Capture and display the current tmux pane content. Uses the default session if not specified.

### Security
- `/run` only allows: `/esc · /exit · /new · /clear · /status` and commands starting with `claude-`
- All other commands are rejected

## Behavior Notes

- `/esc`, `/enter`, `/interrupt`, `/up`, `/down` send tmux key events (not text)
- `/exit`, `/clear`, `/new`, `/startup`, `/startup_continue` forward text commands as-is

## Testing

```bash
pnpm test
pnpm lint:types
pnpm build
```
