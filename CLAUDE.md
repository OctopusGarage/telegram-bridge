# telegram-bridge

Telegram bot that bridges messages to a tmux pane. Built with grammy.

## Commands

All bot commands are registered via `setMyCommands` at startup and driven by data in `src/bot/handlers.ts`:
- `BOT_COMMANDS` — registered to Telegram menu
- `RAW_KEY_COMMANDS` — key events (esc, enter, interrupt, up, down)
- `TEXT_COMMANDS` — text commands forwarded to tmux

## Rule: Keep docs in sync

When adding, removing, or renaming commands, update ALL of:
1. `BOT_COMMANDS` in `src/bot/handlers.ts`
2. `RAW_KEY_COMMANDS` or `TEXT_COMMANDS` in `src/bot/handlers.ts`
3. Help text in `src/bot/handlers.ts` (bot.command("help") handler)
4. `docs/commands.md`
5. `README.md`

Do not ask for permission — just do it when making any command-related change.

## Sensitive Data Isolation

All personal privacy, local paths, and credentials must:

1. **Never hardcode** — Do not write to source code, config files, or docs
2. **Use .env only** — Config data goes in `.env` (excluded from git via `.gitignore`)
3. **Use environment variables** — tokens, keys, paths via `process.env` or `loadConfig()`

**Bad examples** (forbidden):
```typescript
// ❌ Forbidden: hardcoded path
const path = "/home/user/project/...";
const path = "/Users/username/anaconda3/bin/tool";

// ❌ Forbidden: hardcoded token
const token = "abc123xyz";

// ❌ Forbidden: username in test data
expect(isPathAllowed("/Users/username/projects", allowed)).toBe(true);
```

**Good examples**:
```typescript
// ✅ Good: environment variable
const path = process.env.HOME;
const binPath = process.env.TOOL_BIN ?? "tool";

// ✅ Good: via config
const { botToken, allowedCwdRoots } = loadConfig();

// ✅ Good: generic paths in tests
expect(isPathAllowed("/home/user/projects", allowed)).toBe(true);
```

### Pre-commit check

Before committing, run this to catch hardcoded personal paths:

```bash
# Check for hardcoded usernames/paths in source, tests, and docs
grep -rn "username\|/Users/[a-z]\+/\|/home/[a-z]\+/" \
  --include="*.ts" --include="*.js" --include="*.md" \
  src/ tests/ docs/ || echo "✅ No personal paths found"
```

If any matches are found, refactor to use `process.env`, `os.homedir()`, or generic test data before committing.

## Quality gates / tooling

- **Biome** is the linter + formatter. `pnpm lint` (check) / `pnpm format` (write). Config in `biome.json`; `tests/**` disables `complexity/useArrowFunction` so `vi.fn(function(){})` constructor mocks aren't broken into arrows.
- **tsc** does type checking only: `pnpm run lint:types` (covers app + tests). Biome ≠ tsc — keep both.
- **Git hooks (husky)**: `pre-commit` runs lint-staged (Biome on staged) + `lint:types`; `pre-push` runs `pnpm test`. Installed via the `prepare` script on `pnpm install`.
- CI (`.github/workflows/ci.yml`) runs Biome + build + test + type check on ubuntu & macOS; these are required status checks on `main`.

## Releasing

Cut a release from a clean `main`:

```bash
pnpm run release -- patch      # or minor | major | X.Y.Z
# equivalently: bash scripts/release.sh patch
```

`scripts/release.sh` bumps `package.json`, commits `release: vX.Y.Z`, creates an annotated tag, and pushes with `--follow-tags`. The pushed `v*` tag triggers `.github/workflows/release.yml`, which builds/tests and publishes the GitHub release with tar.gz/zip + sha256sum assets.

**Gotcha (already fixed — do not reintroduce):** the version-bump uses `node - "${BUMP}" <<'NODE' … NODE`. The `"${BUMP}"` argument MUST stay on the `node -` invocation line. If it is moved after the closing `NODE` heredoc delimiter it becomes a separate shell command, `process.argv[2]` is undefined, and the script fails with `missing bump`.

Release-packaged files (anything under `scripts/`, `src/`, `.env.example`, etc.) only reach `curl | bash` users in a new release; `install.sh` itself is fetched from `main` so its changes take effect immediately.

## install.sh

- Installs to `~/.telegram-bridge` and a launcher at `~/.local/bin/telegram-bridge`; preserves an existing `.env` across re-installs.
- Sets up the background service by default; skips auto-start (and prints guidance) when `BOT_TOKEN` is empty/placeholder. Opt out with `TGB_SERVICE=0`.

**Gotcha (already fixed — do not reintroduce):** the release-asset name is hardcoded `telegram-bridge-*`, so the installer only makes sense for a telegram-bridge repo. The cwd git-remote auto-detection MUST only adopt a `*/telegram-bridge` remote — otherwise running the canonical `curl .../telegram-bridge/main/install.sh | bash` from inside an unrelated project (e.g. `tmux-claude-bot`) makes it resolve that repo, 404 on the hardcoded asset name, fall back to the wrong source archive, and fail `pnpm install` with a lockfile/overrides mismatch. Any other repo falls back to canonical `OctopusGarage/telegram-bridge`; `TGB_REPO=` still overrides explicitly.
