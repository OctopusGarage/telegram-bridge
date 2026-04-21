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
