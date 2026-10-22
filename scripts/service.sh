#!/usr/bin/env bash
set -euo pipefail

PLIST_NAME="com.octopusgarage.telegram-bridge"
PLIST="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
SERVICE="telegram-bridge"
LOGDIR="${HOME}/.telegram-bridge/logs"

case "$(uname)" in
  Darwin)
    DOMAIN="gui/$(id -u)"
    ;;
  Linux)
    ;;
  *)
    echo "service only supports macOS and Linux in this project." >&2
    exit 1
    ;;
esac

cmd="${1:-status}"

case "$cmd" in
  status)
    if [ "$(uname)" = "Darwin" ]; then
      if [ -f "$PLIST" ]; then
        launchctl list | grep "$PLIST_NAME" || echo "service: not loaded"
      else
        echo "No launchd plist found. Run: ./scripts/install-launchd.sh"
      fi
      ps -ef | grep -E "telegram-bridge.*(src/index.ts|dist/index.js)" | grep -v grep || true
    else
      if command -v systemctl >/dev/null 2>&1; then
        systemctl --user is-active "$SERVICE" 2>/dev/null || true
        systemctl --user status "$SERVICE" --no-pager | sed -n '1,20p' || true
        echo "logs: journalctl --user -u $SERVICE -f"
      else
        echo "systemctl unavailable"
      fi
    fi
    ;;
  pause)
    if [ "$(uname)" = "Darwin" ]; then
      if launchctl bootout "$DOMAIN/$PLIST_NAME" 2>/dev/null; then
        echo "service paused"
      else
        launchctl unload "$PLIST" 2>/dev/null || echo "service not loaded"
      fi
    else
      if command -v systemctl >/dev/null 2>&1; then
        systemctl --user disable --now "$SERVICE" 2>/dev/null || systemctl --user stop "$SERVICE" 2>/dev/null || true
      fi
      echo "service paused"
    fi
    ;;
  resume)
    if [ "$(uname)" = "Darwin" ]; then
      if [ -f "$PLIST" ]; then
        launchctl bootstrap "$DOMAIN" "$PLIST" && echo "service resumed"
      else
        echo "[service] plist not found: $PLIST (run: scripts/install-launchd.sh)" >&2
        exit 1
      fi
    else
      if command -v systemctl >/dev/null 2>&1; then
        systemctl --user enable --now "$SERVICE" && echo "service resumed"
      else
        echo "systemctl unavailable" >&2
        exit 1
      fi
    fi
    ;;
  restart)
    if [ "$(uname)" = "Darwin" ]; then
      launchctl kickstart -k "${DOMAIN}/${PLIST_NAME}" && echo "service restarted"
    else
      if command -v systemctl >/dev/null 2>&1; then
        systemctl --user restart "$SERVICE" && echo "service restarted"
      else
        echo "systemctl unavailable" >&2
        exit 1
      fi
    fi
    ;;
  logs)
    if [ "$(uname)" = "Darwin" ]; then
      mkdir -p "$LOGDIR"
      tail -f "${LOGDIR}/launchd.out.log"
    else
      if command -v journalctl >/dev/null 2>&1; then
        journalctl --user -u "$SERVICE" -f --no-pager
      else
        tail -f "${LOGDIR}/launchd.out.log"
      fi
    fi
    ;;
  *)
    echo "usage: scripts/service.sh <status|pause|resume|restart|logs>" >&2
    exit 1
    ;;
esac
