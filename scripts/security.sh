#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
if [ -f dist/security-cli.js ]; then
  exec node dist/security-cli.js "$@"
fi
exec pnpm exec tsx src/security-cli.ts "$@"
