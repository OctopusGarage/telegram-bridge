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
- **Managed service** - install as launchd on macOS or systemd on Linux.
- **Local state directory** - config, logs, and runtime data stay on the machine.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/OctopusGarage/telegram-bridge/main/install.sh | bash
```

The installer creates `~/.telegram-bridge/.env`. Fill in `BOT_TOKEN`, `ALLOWED_USER_IDS`, and the tmux target, then run the installer again to start the service.

Manual development setup:

```bash
pnpm install
cp .env.example .env
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
```

Empty `ALLOWED_USER_IDS` denies everyone. Set `ALLOW_ALL_USERS=true` only for deliberate local experiments.

## Commands

| Command | Purpose |
|---|---|
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
- The bridge controls one configured tmux target instead of arbitrary system state.
- Dev mode pauses the managed service first to avoid Telegram Bot API conflicts.

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
