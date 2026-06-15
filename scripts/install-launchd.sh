#!/bin/bash
set -euo pipefail
if ! command -v launchctl >/dev/null 2>&1; then
  echo "[install-launchd] launchctl is required for this command (macOS only)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_NAME="com.octopusgarage.telegram-bridge"
TARGET="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
DOMAIN="gui/$(id -u)"

echo_info() { echo "[install-launchd] $*"; }
echo_err() { echo "[install-launchd] $*" >&2; }

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$PROJECT_DIR/logs"

sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$SCRIPT_DIR/telegram-bridge.plist" > "$TARGET"

echo_info "Installed to $TARGET"

if launchctl print "$DOMAIN/$PLIST_NAME" >/dev/null 2>&1; then
  echo_info "Unloading existing launchd service..."
  launchctl bootout "$DOMAIN/$PLIST_NAME" >/dev/null 2>&1 || launchctl unload "$TARGET" >/dev/null 2>&1 || true

  # Wait for the old instance to fully exit before bootstrapping a new one.
  # bootout signals SIGTERM but shutdown is async; if the old and new processes
  # overlap they fight over the single-instance lock / Telegram long-poll (409),
  # leaving the service flapping. Poll up to ~10s, then proceed best-effort.
  for _ in $(seq 1 20); do
    pgrep -f "$PROJECT_DIR/dist/index.js" >/dev/null 2>&1 || break
    sleep 0.5
  done
fi

# A prior `launchctl bootout` (e.g. from uninstall) leaves the label DISABLED in
# launchd's database, which makes the next `bootstrap` fail with "5: Input/output
# error". Clear that state before loading.
launchctl enable "$DOMAIN/$PLIST_NAME" >/dev/null 2>&1 || true

loaded=0
if launchctl bootstrap "$DOMAIN" "$TARGET" >/dev/null 2>&1; then
  loaded=1
elif launchctl load "$TARGET" >/dev/null 2>&1; then
  loaded=1
else
  echo_err "Failed to load launchd service."
  echo_err "This usually happens in restricted shell/CI environments."
  echo_err "Try running locally with:"
  echo_err "  launchctl bootstrap \"$DOMAIN\" \"$TARGET\""
  echo_err "  launchctl start \"$PLIST_NAME\""
  exit 1
fi

if [ "$loaded" -eq 1 ]; then
  echo_info "Service loaded."
fi

if launchctl start "$PLIST_NAME" >/dev/null 2>&1; then
  echo_info "Service started."
else
  echo_err "Service loaded but start command returned no-op/failed."
  echo_err "Try start manually if needed:"
  echo_err "  launchctl start \"$PLIST_NAME\""
  echo_err "  launchctl print \"$DOMAIN/$PLIST_NAME\""
  exit 1
fi

echo_info "Done. Check status with:"
echo "  launchctl print \"$DOMAIN/$PLIST_NAME\""
echo "  launchctl list \"$PLIST_NAME\""
echo "  tail -f $PROJECT_DIR/logs/launchd.err.log"
