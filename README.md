<a id="readme-top"></a>

# Telegram Bridge

[![CI](https://github.com/OctopusGarage/telegram-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/OctopusGarage/telegram-bridge/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/badge/CodeQL-enabled-2088FF?logo=github)](https://github.com/OctopusGarage/telegram-bridge/security/code-scanning)
[![Dependabot](https://img.shields.io/badge/Dependabot-enabled-025E8C?logo=dependabot&logoColor=white)](.github/dependabot.yml)
[![version](https://img.shields.io/github/package-json/v/OctopusGarage/telegram-bridge)](https://github.com/OctopusGarage/telegram-bridge/releases/latest)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-f69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-555555?logo=apple&logoColor=white)](#production)
[![Checked with Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?logo=biome&logoColor=white)](https://biomejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<p align="center">
  A Telegram bot that bridges chat messages into a local <a href="https://github.com/tmux/tmux">tmux</a> pane —
  send <code>/run &lt;command&gt;</code> from Telegram and it streams back only the <em>new</em> pane output.
  Built for remote-driving <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a> sessions from your phone.
  <br />
  <br />
  <a href="docs/commands.md"><strong>Command reference »</strong></a>
  ·
  <a href="https://github.com/OctopusGarage/telegram-bridge/issues">Issues</a>
  ·
  <a href="https://github.com/OctopusGarage/telegram-bridge/releases">Releases</a>
</p>

<details>
  <summary>Table of Contents</summary>

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Install (one line)](#install-one-line)
- [Development](#development)
- [Production](#production)
- [Release](#release)
- [Commands](#commands)
- [Behavior Notes](#behavior-notes)
- [Resilience](#resilience)
- [Testing](#testing)
- [License](#license)

</details>

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
TMUX_SESSION=telegram_tmux_session   # default target session (auto-created if missing)
TMUX_WINDOW=0
TMUX_PANE=0
POLL_INTERVAL_MS=1200
MAX_MESSAGE_LENGTH=3500
IDLE_POLL_TICKS=3
MAX_POLL_TICKS=20
HTTPS_PROXY=http://127.0.0.1:7890
# Comma-separated Telegram user IDs — fail closed: empty denies everyone
ALLOWED_USER_IDS=123456789,987654321
# Set true ONLY to deliberately disable the allowlist (anyone can control the pane)
ALLOW_ALL_USERS=false
TGB_STATE_DIR=                                  # Optional (defaults to ~/.telegram-bridge)
MAX_QUEUE_SIZE=30
MAX_CONCURRENT_SESSIONS=3
RATE_LIMIT_MS=2000
SESSION_RATE_LIMIT_MS=1200
GLOBAL_RATE_LIMIT_MS=500
# Commands allowed via /run: comma-separated, auto-anchored, case-insensitive
# regex patterns. Empty = deny all (fail closed). e.g. claude(-[a-z]+)?
ALLOWED_RUN_PATTERNS=
```

Example tmux target:

```bash
tmux new-session -d -s telegram-bridge
```

## Install (one line)

```bash
curl -fsSL https://raw.githubusercontent.com/OctopusGarage/telegram-bridge/main/install.sh | bash
```

This downloads the latest release into `~/.telegram-bridge`, installs a launcher at
`~/.local/bin/telegram-bridge`, and — once your config is filled in — sets up a background
service (auto-restart on crash, start at login).

- The first run creates `~/.telegram-bridge/.env`. Fill in `BOT_TOKEN` (and the rest), then
  re-run the command — the installer **skips auto-start while `BOT_TOKEN` is still a
  placeholder** and tells you what to do next.
- Skip the background service entirely with `TGB_SERVICE=0 bash install.sh`.
- Update later by re-running the command; pin a version with `TGB_VERSION=<tag> bash install.sh`.
- One install path per user by default. A second `TGB_INSTALL_DIR` fails unless
  `TGB_ALLOW_MULTIPLE_INSTALLS=1` is explicitly set.

## Development

```bash
pnpm dev
```

### Dev mode (recommended)

```bash
pnpm run dev:local
```

`dev:local` does three things:

- pauses launchd service first (to avoid Telegram Bot API 409 Conflict),
- runs `pnpm dev` with hot-reload,
- restores managed service on exit.

If `$HOME/.telegram-bridge/.env` exists, dev mode reuses it; otherwise it uses the working-directory `.env`.

## Production

### Service mode (macOS / Linux)

Manage:
```bash
pnpm run service:install    # install service (macOS: launchd, Linux: systemd)
pnpm run service:pause       # pause service
pnpm run service:resume      # resume launchd service
pnpm run service:restart     # restart launchd service
pnpm run service:status      # status
pnpm run service:logs        # tail logs
pnpm run service:uninstall   # uninstall launchd service
```

Logs:
- macOS: `logs/launchd.out.log`, `logs/launchd.err.log`
- Linux: `journalctl --user -u telegram-bridge`

### Manual

```bash
pnpm build
pnpm start
```

## Release

### Local release workflow

1. Make sure you are on `main` and working tree is clean.
2. Run release:

```bash
pnpm run release -- patch
# or pnpm run release -- minor|major|1.2.3
```

The script will:

- bump `package.json` version,
- create commit `release: vX.Y.Z`,
- create annotated tag `vX.Y.Z`,
- push to origin.

### How release notes are generated and where assets live

GitHub release is created automatically by workflow on `v*` tags:

```bash
/.github/workflows/release.yml
```

Release notes are generated from commit messages in the tag-to-tag range and include:

- non-release changes (`git log` section),
- install scripts by platform,
- full changelog link.

You can still edit release notes manually from GitHub UI when needed.

Release assets generated by `.github/workflows/release.yml`:
- `telegram-bridge-vX.Y.Z-release.tar.gz`
- `telegram-bridge-vX.Y.Z-release.tar.gz.sha256sum`
- `telegram-bridge-vX.Y.Z-release.zip`
- `telegram-bridge-vX.Y.Z-release.zip.sha256sum`

## Commands

> Full reference: [docs/commands.md](docs/commands.md)

### `/run [session] <command>`
Send a command to tmux. The command must match `ALLOWED_RUN_PATTERNS` (fail closed — nothing is allowed until you configure it). Session name is optional; defaults to the one configured in `.env`.
If restart happens with pending queue items, they are restored from disk (`$TGB_STATE_DIR/.queue/pending.json`, defaults to `~/.telegram-bridge/.queue/pending.json`) and replayed.

### `/queue_status`
Show current queue status:
- total queue length
- per-session waiting list
- currently running session item

| Example | session | command | allowed when… |
|---------|---------|---------|---------------|
| `/run npm test` | default | `npm test` | `ALLOWED_RUN_PATTERNS` matches `npm test` |
| `/run main claude` | `main` | `claude` | `ALLOWED_RUN_PATTERNS` matches `claude` |

> Fixed key/text commands (`/esc`, `/enter`, `/interrupt`, `/up`, `/down`, `/exit`, `/clear`, `/new`) are always available and are **not** gated by `ALLOWED_RUN_PATTERNS` — only free-form `/run <cmd>` is.

### `/peek [session]`
Capture and display the current tmux pane content. Uses the default session if not specified.

### Security
- `/run <cmd>` is allowed only if `<cmd>` fully matches one of `ALLOWED_RUN_PATTERNS` (auto-anchored, case-insensitive regexes). Empty = deny all (fail closed).
- The fixed key/text commands above are the only other way to drive the pane. Everything else is rejected.

## Behavior Notes

- `/esc`, `/enter`, `/interrupt`, `/up`, `/down` send tmux key events (not text)
- `/exit`, `/clear`, `/new` forward text commands as-is

## Resilience

| Mechanism | Behavior |
|-----------|----------|
| Network retry | `getMe` retries 5× with exponential backoff (1s→30s) before starting |
| Process auto-restart | launchd `KeepAlive` restarts bot on crash |
| Proxy empty string | `.env` empty `HTTP_PROXY=` handled correctly |

## Testing

```bash
pnpm test          # run the test suite (vitest)
pnpm lint          # Biome lint + format check
pnpm format        # Biome auto-fix + format in place
pnpm lint:types    # tsc type check (app + tests)
pnpm build
```

> Git hooks (husky): `pre-commit` runs Biome on staged files + type check; `pre-push` runs the test suite.

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for details.

<p align="right">(<a href="#readme-top">back to top</a>)</p>
