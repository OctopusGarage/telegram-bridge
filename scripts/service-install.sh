#!/usr/bin/env bash
set -euo pipefail

case "$(uname -s)" in
  Darwin)
    exec ./scripts/install-launchd.sh
    ;;
  Linux)
    exec ./scripts/install-systemd.sh
    ;;
  *)
    echo "service install supports macOS and Linux only in this project." >&2
    exit 1
    ;;
esac
