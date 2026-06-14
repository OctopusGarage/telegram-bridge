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
