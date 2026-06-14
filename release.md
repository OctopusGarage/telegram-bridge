# Release Standard (telegram-bridge)

Use one unified release format so install scripts and CI validation stay consistent.

## Required release artifacts

Each release must include four assets:

- `telegram-bridge-vX.Y.Z-release.tar.gz`
- `telegram-bridge-vX.Y.Z-release.tar.gz.sha256sum`
- `telegram-bridge-vX.Y.Z-release.zip`
- `telegram-bridge-vX.Y.Z-release.zip.sha256sum`

## Release commands

### 1) Preflight

```bash
pnpm build
pnpm test
```

### 2) Create release package

```bash
pnpm run release:package vX.Y.Z
```

### 3) Tag and push

```bash
pnpm run release -- patch  # or minor/major/1.2.3
```

This creates `vX.Y.Z`, pushes commit and tag, and GitHub workflow publishes release assets.

### 4) Validate install on macOS / Linux

```bash
# 官方仓库
curl -fsSL https://raw.githubusercontent.com/OctopusGarage/telegram-bridge/main/install.sh | bash
# 或 fork 仓库
# curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/install.sh | bash
# 或本地仓库内
bash install.sh
telegram-bridge
```

### 5) Validate release CI

```bash
gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId' | xargs -I{} gh run watch {}
```

## Update on release page

- The release workflow auto-generates release notes from tag-to-tag commit diffs.
- Release body format:
  - `Changed` header + bullet diff lines
  - `One-line install / update:` block with curl install command
  - `Full Changelog` link to compare page
