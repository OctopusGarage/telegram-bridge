#!/usr/bin/env bash

set -euo pipefail

REPO="${TGB_REPO:-${GITHUB_REPOSITORY:-}}"
if [ -z "$REPO" ] && [ -d .git ] && command -v git >/dev/null 2>&1; then
  REPO_REMOTE="$(git remote get-url origin 2>/dev/null || true)"
  if [ -n "$REPO_REMOTE" ]; then
    REPO_CANDIDATE="$REPO_REMOTE"
    case "$REPO_CANDIDATE" in
      https://*|http://*) REPO_CANDIDATE="${REPO_CANDIDATE#*://*/}" ;;
      ssh://*) REPO_CANDIDATE="${REPO_CANDIDATE#ssh://*/}" ;;
      git@*) REPO_CANDIDATE="${REPO_CANDIDATE#*:}" ;;
    esac
    REPO_CANDIDATE="${REPO_CANDIDATE%.git}"
    # Only adopt the current directory's repo if it is actually a
    # telegram-bridge checkout/fork. When this script is piped via curl while
    # cd'd into an unrelated project, the cwd remote must NOT hijack the install
    # — the release asset name is hardcoded telegram-bridge-*, so an unrelated
    # repo would 404 and then install the wrong source. Fall back to canonical.
    case "$REPO_CANDIDATE" in
      */telegram-bridge) REPO="$REPO_CANDIDATE" ;;
      *) ;;
    esac
  fi
fi
REPO="${REPO:-OctopusGarage/telegram-bridge}"
CANONICAL_INSTALL_DIR="${HOME}/.telegram-bridge"
INSTALL_DIR="${TGB_INSTALL_DIR:-$CANONICAL_INSTALL_DIR}"
BIN_DIR="$HOME/.local/bin"
CONFIG_PATH="$INSTALL_DIR/.env"
VERSION="${TGB_VERSION:-latest}"
ORIGINAL_PATH="$PATH"
NODE_BIN="${TGB_NODE_BIN:-${TGB_NODE:-$(command -v node || true)}}"
ALLOW_MULTIPLE="${TGB_ALLOW_MULTIPLE_INSTALLS:-0}"
SETUP_SERVICE="${TGB_SERVICE:-1}"
ACTIVE_INSTALL_MARKER="${HOME}/.telegram-bridge-install-path"

info() { printf '%s\n' ">= $*"; }
err() { printf '%s\n' "xx $*" >&2; }

case "$(uname)" in
  Darwin|Linux) ;;
  *) err "telegram-bridge installer supports macOS and Linux."; exit 1 ;;
esac

ACTIVE_INSTALL_DIR=""
if [ -f "$ACTIVE_INSTALL_MARKER" ]; then
  ACTIVE_INSTALL_DIR="$(tr -d '\r\n' < "$ACTIVE_INSTALL_MARKER")"
fi
if [ -n "${ACTIVE_INSTALL_DIR:-}" ] && [ ! -d "$ACTIVE_INSTALL_DIR" ]; then
  rm -f "$ACTIVE_INSTALL_MARKER"
  ACTIVE_INSTALL_DIR=""
fi
if [ -z "${ACTIVE_INSTALL_DIR:-}" ] && [ -d "$CANONICAL_INSTALL_DIR" ]; then
  ACTIVE_INSTALL_DIR="$CANONICAL_INSTALL_DIR"
fi
if [ "$ALLOW_MULTIPLE" != "1" ] && [ -n "${ACTIVE_INSTALL_DIR:-}" ] && [ "$INSTALL_DIR" != "$ACTIVE_INSTALL_DIR" ]; then
  err "A telegram-bridge installation already exists at $ACTIVE_INSTALL_DIR."
  err "To avoid Telegram long-polling conflicts, keep a single runtime instance per user."
  err "Use TGB_INSTALL_DIR=$ACTIVE_INSTALL_DIR (or unset TGB_INSTALL_DIR) to update in-place,"
  err "or set TGB_ALLOW_MULTIPLE_INSTALLS=1 to install a second path explicitly."
  exit 1
fi

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  err "node is required. Install Node.js 22+ first."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    info "Installing pnpm with corepack..."
    corepack prepare pnpm@latest --activate
  else
    err "pnpm is required and corepack is not available. Install pnpm first."
    exit 1
  fi
fi

if [ "$VERSION" = "latest" ]; then
  info "Resolving latest release tag..."
  latest_json="$(mktemp)"
  if ! curl -fsSL -A "telegram-bridge-installer" "https://api.github.com/repos/${REPO}/releases/latest" -o "$latest_json"; then
    rm -f "$latest_json"
    err "Failed to resolve latest release from GitHub API."
    exit 1
  fi
  TAG="$(grep -m1 '"tag_name"' "$latest_json" | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  rm -f "$latest_json"

  if [ -z "$TAG" ]; then
    err "Unable to parse latest release tag from GitHub API response."
    exit 1
  fi

  if [ "$TAG" = "null" ]; then
    err "Invalid latest release tag returned: $TAG"
    exit 1
  fi
else
  TAG="$VERSION"
fi

case "$TAG" in
  v*) ;;
  *) err "Invalid release tag: $TAG"; exit 1 ;;
esac

PACKAGE="telegram-bridge-${TAG}-release"
WORKDIR="$(mktemp -d)"
ARCHIVE="${WORKDIR}/release.tar.gz"
trap 'rm -rf "$WORKDIR"' EXIT

info "Downloading telegram-bridge ${TAG}..."
if ! curl -fsSL --max-time 120 "https://github.com/$REPO/releases/download/$TAG/${PACKAGE}.tar.gz" -o "$ARCHIVE"; then
  info "Release package not found, fallback to source archive..."
  if ! curl -fsSL --max-time 120 "https://github.com/$REPO/archive/refs/tags/$TAG.tar.gz" -o "$ARCHIVE"; then
    err "Download failed for $TAG"
    exit 1
  fi
fi

mkdir -p "$INSTALL_DIR"
if [ -f "$CONFIG_PATH" ]; then
  mkdir -p "${WORKDIR}/keep"
  cp "$CONFIG_PATH" "${WORKDIR}/keep/.env"
fi

tar -xzf "$ARCHIVE" --strip-components=1 -C "$INSTALL_DIR"

if [ -f "${WORKDIR}/keep/.env" ]; then
  cp "${WORKDIR}/keep/.env" "$CONFIG_PATH"
fi

if [ -f "$CONFIG_PATH" ]; then
  info "Config found at $CONFIG_PATH"
else
  if [ -f "$INSTALL_DIR/.env.example" ]; then
    cp "$INSTALL_DIR/.env.example" "$CONFIG_PATH"
    info "Created $CONFIG_PATH from .env.example; fill your bot credentials before start."
  fi
fi

info "Installing dependencies..."
cd "$INSTALL_DIR"
# --ignore-scripts: prod deployments don't need lifecycle scripts. In particular
# the "prepare" script runs husky (a devDependency, absent under --prod, and
# pointless here since the install dir is not a git repo), which would otherwise
# fail the whole install with "husky: command not found".
pnpm install --frozen-lockfile --prod --ignore-scripts

mkdir -p "$BIN_DIR"
info "Installing launcher $BIN_DIR/telegram-bridge"
cat >"$BIN_DIR/telegram-bridge" <<EOF_RUNNER
#!/usr/bin/env bash
set -euo pipefail
cd "$INSTALL_DIR"
exec "$NODE_BIN" "$INSTALL_DIR/dist/index.js" "\$@"
EOF_RUNNER
chmod +x "$BIN_DIR/telegram-bridge"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) export PATH="$BIN_DIR:$PATH" ;;
esac

info "Checking node runtime..."
"$NODE_BIN" --version >/dev/null

info "Done. Installed telegram-bridge $TAG at $INSTALL_DIR"

# Only auto-start the background service when the config is actually filled in.
# An empty/placeholder BOT_TOKEN means the bot cannot connect, so starting a
# KeepAlive service would just crash-loop with no hint — guide the user instead.
CONFIG_READY=1
TOKEN_VAL="$(grep -E '^BOT_TOKEN=' "$CONFIG_PATH" 2>/dev/null | head -n1 | sed 's/^BOT_TOKEN=//')"
if [ -z "$TOKEN_VAL" ] || [ "$TOKEN_VAL" = "replace-me" ]; then
  CONFIG_READY=0
fi

# Best-effort: a failure here (e.g. restricted/headless shell) must not fail the
# install. Opt out of the service entirely with TGB_SERVICE=0.
SERVICE_ACTIVE=0
if [ "$SETUP_SERVICE" = "0" ]; then
  info "Skipped background service setup (TGB_SERVICE=0)."
elif [ "$CONFIG_READY" != "1" ]; then
  info "Config at $CONFIG_PATH is not filled in yet (BOT_TOKEN is empty or 'replace-me')."
  info "Edit it with your real bot token and settings, then start the service with:"
  info "  cd $INSTALL_DIR && pnpm run service:install"
  info "(Skipping auto-start until the config is ready.)"
else
  info "Setting up background service (auto-restart on crash, start at login)..."
  if ( cd "$INSTALL_DIR" && bash scripts/service-install.sh ); then
    SERVICE_ACTIVE=1
    info "Service is up and will keep running in the background."
  else
    err "Could not set up the background service automatically."
    err "This often happens in restricted/headless shells (CI, SSH without a login session)."
    err "Set it up later from $INSTALL_DIR with:  pnpm run service:install"
  fi
fi

if [ "$SERVICE_ACTIVE" != "1" ] && [ "$CONFIG_READY" = "1" ]; then
  info "Run in the foreground with: telegram-bridge"
fi
info "Update later with: TGB_VERSION=<tag> TGB_REPO=<repo> bash install.sh"
info "Disable auto-start service with: TGB_SERVICE=0 bash install.sh"
if [ -n "$ORIGINAL_PATH" ] && [[ ":$ORIGINAL_PATH:" != *":$BIN_DIR:"* ]]; then
  info "Add $BIN_DIR to PATH to use the global command."
fi
printf '%s\n' "$INSTALL_DIR" > "$ACTIVE_INSTALL_MARKER"
