#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

LABEL="com.octopusgarage.telegram-bridge"
PAUSED=0

if command -v launchctl >/dev/null 2>&1 && launchctl list "$LABEL" >/dev/null 2>&1; then
  echo "=> Pausing managed service before dev start..."
  pnpm run service:pause || true
  PAUSED=1
fi

restore_service() {
  if [ "$PAUSED" = "1" ]; then
    echo "=> Resuming managed service..."
    pnpm run service:resume 2>/dev/null || true
  fi
}
trap restore_service EXIT INT TERM

if [ -z "${TGB_ENV_FILE:-}" ]; then
  if [ -f "$PROJECT_DIR/.env" ]; then
    export TGB_ENV_FILE="$PROJECT_DIR/.env"
    echo "=> Dev mode: using local env file $TGB_ENV_FILE"
  else
    export TGB_ENV_FILE="$HOME/.telegram-bridge/.env"
    echo "=> Dev mode: using global env file $TGB_ENV_FILE"
  fi
else
  echo "=> Dev mode: using env file $TGB_ENV_FILE"
fi

if [ -z "${TGB_STATE_DIR:-}" ]; then
  export TGB_STATE_DIR="$HOME/.telegram-bridge"
  mkdir -p "$TGB_STATE_DIR"
  if [ -d "$HOME/.telegram-bridge" ]; then
    echo "=> Dev mode: using global state dir $TGB_STATE_DIR"
  else
    echo "=> Dev mode: created default state dir $TGB_STATE_DIR"
  fi
fi

if [ ! -f "$TGB_ENV_FILE" ]; then
  echo "No config file at $TGB_ENV_FILE." >&2
  echo "Set TGB_ENV_FILE to a valid .env file with BOT_TOKEN (e.g. TGB_ENV_FILE=$PROJECT_DIR/.env)." >&2
  exit 1
fi

echo "=> Dev mode started (hot-reload). Ctrl-C to stop and resume managed service."
pnpm dev
