#!/usr/bin/env bash
set -euo pipefail

if ! command -v systemctl >/dev/null 2>&1; then
  echo "[install-systemd] systemctl is required (Linux only)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_DIR="$HOME/.config/systemd/user"
UNIT_NAME="telegram-bridge"
SERVICE_PATH="$SERVICE_DIR/${UNIT_NAME}.service"
TEMPLATE="$SCRIPT_DIR/telegram-bridge.service"
mkdir -p "$SERVICE_DIR" "$PROJECT_DIR/logs"

sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$TEMPLATE" > "$SERVICE_PATH"
systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME.service"

echo "[install-systemd] Installed service at $SERVICE_PATH"
