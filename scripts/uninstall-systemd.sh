#!/usr/bin/env bash
set -euo pipefail

if ! command -v systemctl >/dev/null 2>&1; then
  echo "[uninstall-systemd] systemctl is required (Linux only)" >&2
  exit 1
fi

SERVICE_DIR="$HOME/.config/systemd/user"
UNIT_NAME="telegram-bridge"
SERVICE_PATH="$SERVICE_DIR/${UNIT_NAME}.service"

systemctl --user disable --now "$UNIT_NAME.service" 2>/dev/null || true
if [ -f "$SERVICE_PATH" ]; then
  rm -f "$SERVICE_PATH"
  systemctl --user daemon-reload
  echo "[uninstall-systemd] removed $SERVICE_PATH"
else
  echo "[uninstall-systemd] no systemd service found"
fi
