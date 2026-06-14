#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

NODE_BIN="${TGB_NODE_BIN:-${TGB_NODE:-}}"
if [ -z "$NODE_BIN" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  NODE_BIN_DIR="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)"
  if [ -n "$NODE_BIN_DIR" ]; then
    NODE_BIN="$HOME/.nvm/versions/node/$NODE_BIN_DIR/bin/node"
  fi
fi
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "[telegram-bridge-runner] node not found. Install node first." >&2
  exit 1
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH}"
cd "$PROJECT_DIR"

if [ -f "$PROJECT_DIR/dist/index.js" ]; then
  exec "$NODE_BIN" "$PROJECT_DIR/dist/index.js"
fi

if [ -f "$PROJECT_DIR/src/index.ts" ] && [ -d "$PROJECT_DIR/node_modules/tsx" ]; then
  exec "$NODE_BIN" \
    --require "$PROJECT_DIR/node_modules/tsx/dist/preflight.cjs" \
    --import "file://$PROJECT_DIR/node_modules/tsx/dist/loader.mjs" \
    "$PROJECT_DIR/src/index.ts"
fi

echo "telegram-bridge runtime not ready: dist/index.js missing and tsx deps not installed." >&2
exit 1
