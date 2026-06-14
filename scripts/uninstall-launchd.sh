#!/usr/bin/env bash
set -euo pipefail
if ! command -v launchctl >/dev/null 2>&1; then
  echo "[uninstall-launchd] launchctl is required for this command (macOS only)" >&2
  exit 1
fi

LABEL="com.octopusgarage.telegram-bridge"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"

if [ -f "$PLIST" ]; then
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "[uninstall-launchd] removed $PLIST"
else
  echo "[uninstall-launchd] no launchd plist found: $PLIST"
fi
