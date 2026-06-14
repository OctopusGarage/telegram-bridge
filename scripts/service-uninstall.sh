#!/usr/bin/env bash
set -euo pipefail

case "$(uname -s)" in
  Darwin)
    exec ./scripts/uninstall-launchd.sh
    ;;
  Linux)
    exec ./scripts/uninstall-systemd.sh
    ;;
  *)
    echo "service uninstall supports macOS and Linux only in this project." >&2
    exit 1
    ;;
esac
