#!/usr/bin/env bash
set -euo pipefail

# Cut a release by bumping package.json version and creating a signed-off tag.
# Usage:
#   pnpm run release -- patch
#   pnpm run release -- minor
#   pnpm run release -- major
#   pnpm run release -- 1.2.3

BUMP="${1:-}"

if [ -z "${BUMP}" ]; then
  echo "usage: pnpm run release -- <patch|minor|major|X.Y.Z>" >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "${BRANCH}" != "main" ]; then
  echo "release must run on main (on '${BRANCH}')" >&2
  exit 1
fi

git diff --quiet && git diff --cached --quiet || {
  echo "working tree must be clean" >&2
  exit 1
}

git pull --ff-only origin main

NEW_VERSION="$(node - "${BUMP}" <<'NODE'
const fs = require("fs");

const bump = process.argv[2];
if (!bump) throw new Error("missing bump");

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const [major, minor, patch] = String(pkg.version).split(".").map((value) => Number(value));
if (![major, minor, patch].every((n) => Number.isInteger(n) && n >= 0)) {
  throw new Error(`invalid current version: ${pkg.version}`);
}

let next;
if (/^\d+\.\d+\.\d+$/.test(bump)) {
  next = bump;
} else if (bump === "patch") {
  next = `${major}.${minor}.${patch + 1}`;
} else if (bump === "minor") {
  next = `${major}.${minor + 1}.0`;
} else if (bump === "major") {
  next = `${major + 1}.0.0`;
} else {
  throw new Error(`unsupported bump: ${bump}`);
}

pkg.version = next;
fs.writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
console.log(next);
NODE
)"

if [ -z "${NEW_VERSION}" ]; then
  echo "failed to compute next version" >&2
  exit 1
fi

git add package.json
git commit -m "release: v${NEW_VERSION}"
git tag -a "v${NEW_VERSION}" -m "release: v${NEW_VERSION}"

git push --follow-tags origin main

echo "Created release v${NEW_VERSION}."
echo "GitHub Action will publish the release on push of tag v${NEW_VERSION}."
