#!/usr/bin/env bash

set -euo pipefail

if [[ "$1" == "--" ]]; then
  shift
fi

if [[ $# -ne 1 ]]; then
  echo "Usage: scripts/release-package.sh <version>" >&2
  echo "Example: scripts/release-package.sh v0.1.0" >&2
  exit 1
fi

VERSION="$1"
[[ "$VERSION" == v* ]] || VERSION="v${VERSION}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
TMP_DIR="$(mktemp -d)"
PACKAGE_NAME="telegram-bridge-${VERSION}-release"
PACKAGE_DIR="$TMP_DIR/$PACKAGE_NAME"

TAR_FILE="$DIST_DIR/${PACKAGE_NAME}.tar.gz"
ZIP_FILE="$DIST_DIR/${PACKAGE_NAME}.zip"
TAR_SUM="$DIST_DIR/${PACKAGE_NAME}.tar.gz.sha256sum"
ZIP_SUM="$DIST_DIR/${PACKAGE_NAME}.zip.sha256sum"

REQUIRED=(
  "$ROOT_DIR/package.json"
  "$ROOT_DIR/pnpm-lock.yaml"
  "$ROOT_DIR/README.md"
  "$ROOT_DIR/.env.example"
  "$ROOT_DIR/install.sh"
  "$ROOT_DIR/start.sh"
  "$ROOT_DIR/scripts"
  "$ROOT_DIR/dist"
)

for file in "${REQUIRED[@]}"; do
  if [ ! -e "$file" ]; then
    echo "Missing required file for release package: $file" >&2
    exit 1
  fi
done

if [ ! -f "$ROOT_DIR/dist/index.js" ]; then
  echo "Expected dist/index.js for runtime release package. Run pnpm build first." >&2
  exit 1
fi

mkdir -p "$DIST_DIR"
rm -f "$TAR_FILE" "$ZIP_FILE" "$TAR_SUM" "$ZIP_SUM"
mkdir -p "$PACKAGE_DIR"

for item in "${REQUIRED[@]}"; do
  cp -R "$item" "$PACKAGE_DIR/"
done
cp -f "$ROOT_DIR/README.md" "$PACKAGE_DIR/INSTALL.md"

if [ -d "$PACKAGE_DIR/dist" ]; then
  find "$PACKAGE_DIR/dist" -maxdepth 1 -type f \( -name "*.tar.gz" -o -name "*.tar.gz.sha256sum" -o -name "*.zip" -o -name "*.zip.sha256sum" \) -delete
fi

tar -czf "$TAR_FILE" -C "$TMP_DIR" "$PACKAGE_NAME"
( cd "$TMP_DIR" && zip -r "$ZIP_FILE" "$PACKAGE_NAME" >/dev/null )

hash_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $2}'
  else
    return 1
  fi
}

TAR_HASH="$(hash_file "$TAR_FILE")"
ZIP_HASH="$(hash_file "$ZIP_FILE")"
if [ -z "$TAR_HASH" ] || [ -z "$ZIP_HASH" ]; then
  echo "Unable to compute SHA-256 checksums." >&2
  exit 1
fi

printf "%s  %s\n" "$TAR_HASH" "$(basename "$TAR_FILE")" > "$TAR_SUM"
printf "%s  %s\n" "$ZIP_HASH" "$(basename "$ZIP_FILE")" > "$ZIP_SUM"

for artifact in "$TAR_FILE" "$TAR_SUM" "$ZIP_FILE" "$ZIP_SUM"; do
  ls -lh "$artifact"
done

echo "Release artifacts generated:"
cat "$TAR_SUM"
cat "$ZIP_SUM"

rm -rf "$TMP_DIR"
