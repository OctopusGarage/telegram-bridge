# Install telegram-bridge

## One-line install (recommended)

```bash
# 官方仓库
curl -fsSL https://raw.githubusercontent.com/OctopusGarage/telegram-bridge/main/install.sh | bash

# 你的 fork（推荐）
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/install.sh | bash

# 或当前项目目录直接执行（自动识别当前仓库 origin）
bash install.sh
```

The installer will:

- download the latest release package
- run `pnpm install --prod`
- install `telegram-bridge` in `~/.local/bin`
- create `~/.telegram-bridge/.env` from `.env.example` when missing

Telegram Bot only supports a single runtime instance per user account; by default this installer blocks installing to a second path.

If you need a second isolated instance (non-default mode), set:

- `TGB_ALLOW_MULTIPLE_INSTALLS=1`

Otherwise, install to the default path (`~/.telegram-bridge`) or set `TGB_INSTALL_DIR` to the same path to update in place.

If your repo is not `OctopusGarage/telegram-bridge`, set `TGB_REPO=owner/name` or use the matching raw.githubusercontent fork URL before running install.

## Service mode

- macOS/Linux: `pnpm run service:install` and status with `pnpm run service:status`
- Linux service is backed by `systemd --user`; macOS is `launchd`.

## Authenticator setup

After configuring the installed `.env`, run `telegram-bridge security setup` in a trusted
local terminal, scan the QR with Google Authenticator, verify its code, and restart the
service. Terminal access stays locked until enrollment. In Telegram, use `/unlock` and
then `/approve <request-id> <code>`. See [the security guide](docs/security.md) for session
scope, emergency `security revoke`, local recovery and deployment isolation.
