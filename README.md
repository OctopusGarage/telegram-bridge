# Telegram Bridge

A small Telegram-to-tmux bridge for driving a local command-line agent from chat.

[![CI](https://github.com/OctopusGarage/telegram-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/OctopusGarage/telegram-bridge/actions/workflows/ci.yml)
[![Release](https://github.com/OctopusGarage/telegram-bridge/actions/workflows/release.yml/badge.svg)](https://github.com/OctopusGarage/telegram-bridge/actions/workflows/release.yml)
[![Node](https://img.shields.io/badge/Node-24%2B-339933?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?logo=biome&logoColor=white)](https://biomejs.dev)
[![License](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

## Why

Sometimes you do not need a full agent control plane. You just need a private Telegram bot that sends commands into a tmux pane and streams back the new output. Telegram Bridge keeps that surface small, explicit, and locked down by default.

## Features

- **tmux command bridge** - send `/run <command>` to a configured tmux target.
- **New-output streaming** - replies include only pane output produced after the command.
- **Queue-based execution** - avoid interleaved commands and mixed responses.
- **Fail-closed allowlist** - only configured Telegram users can control the pane.
- **Command allowlist** - restrict `/run` to approved regex patterns.
- **Authenticator verification** - local Google Authenticator compatible TOTP, short-lived session access, and single-use session-removal approval.
- **Session scope** - only configured sessions are visible or controllable; terminal input and pane reads require authorization.
- **Managed service** - install as launchd on macOS or systemd on Linux.
- **Local state directory** - config, logs, and runtime data stay on the machine.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/OctopusGarage/telegram-bridge/main/install.sh | bash
```

The installer creates `~/.telegram-bridge/.env`. Fill in `BOT_TOKEN`, `ALLOWED_USER_IDS`, and the tmux target, then run `telegram-bridge security setup` in a trusted local terminal to enroll your authenticator. Restart the service after setup. Without enrollment, terminal operations stay locked.

Manual development setup:

```bash
pnpm install
cp .env.example .env
pnpm security setup
pnpm run dev:local
```

## Minimal Configuration

```dotenv
BOT_TOKEN=your-bot-token
TMUX_SESSION=telegram-bridge
TMUX_WINDOW=0
TMUX_PANE=0
ALLOWED_USER_IDS=123456789
ALLOW_ALL_USERS=false
ALLOWED_RUN_PATTERNS=claude(-[a-z]+)?,codex
AUTH_SESSION_TTL_SECONDS=300
```

Empty `ALLOWED_USER_IDS` denies everyone. Keep `ALLOW_ALL_USERS=false`; second-factor authorization always requires explicit user IDs. Setup writes `TOTP_SECRET` to the selected `.env`; never send the secret or enrollment QR through Telegram. Optionally set `ALLOWED_TMUX_SESSIONS` (empty means the default session only) and `TMUX_SOCKET` for a named tmux server.

In your private bot chat, send `/unlock [session]`. The bot sends the authorization details first, then a separate `/approve <request-id> <6-digit code>` message. Copy the second message, replace the code placeholder with your authenticator code, and send it. The default grant lasts five minutes for that session. Use `/lock` to revoke it. `/remove` always needs a separate approval, including while unlocked.

## Commands

| Command | Purpose |
|---|---|
| `/unlock [session]` | Request a short-lived authenticator grant for one session. |
| `/approve <request-id> <code>` | Approve an unlock or session-removal request once. |
| `/lock` | Revoke your active grants and pending approval. |
| `/run [session] <cmd>` | Send an allowed command to the tmux pane and stream new output back. |
| `/peek [session]` | Capture and reply with current pane text. |
| `/sessions` | List known tmux sessions. |
| `/queue_status` | Show queued and running work. |
| `/cwd <path>` | Change the current working directory inside allowed roots. |
| `/help` | Show available commands and usage notes. |

See [docs/commands.md](docs/commands.md) for the full command reference.

## Service Operations

```bash
pnpm run service:install
pnpm run service:status
pnpm run service:logs
pnpm run service:restart
pnpm run service:pause
pnpm run service:resume
pnpm run service:uninstall
```

## Safety Design

- Access is denied unless a Telegram user ID is explicitly allowed.
- Command patterns are denied by default unless configured.
- Queue size and rate limits prevent runaway chat input.
- Every terminal write and pane read requires a private-chat, user and session scoped authenticator grant.
- Session removal requires its own immutable, expiring, single-use approval.
- Queued input is rechecked before delivery and discarded after restart; authorizations never survive restart.
- `pnpm security revoke` (or `telegram-bridge security revoke`) locally suspends remote access; local `resume`, `reset` and `setup` support recovery.
- Dev mode pauses the managed service first to avoid Telegram Bot API conflicts.

TOTP submitted through Telegram is not phishing-resistant. Anyone controlling your account during an active grant can use that session. The backend and its OS account remain trusted; use a dedicated account or VM to protect host resources. Regexes and working directories are not sandboxes. Read [the security and recovery guide](docs/security.md) before deployment.

## Development

```bash
pnpm run build
pnpm test
pnpm run lint
pnpm run lint:types
```

## Related

- [tmux-claude-bot](https://github.com/OctopusGarage/tmux-claude-bot) - a richer multi-project control plane for Claude Code and Codex.
- [OctopusGarage](https://github.com/OctopusGarage) - small tools for AI agents, local automation, and browser-native products.

## License

MIT
