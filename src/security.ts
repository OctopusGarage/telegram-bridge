// Security: whitelist-only command validation
// Only these patterns are allowed through /run [session] <cmd>

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

// Only these command patterns are allowed
export const SPECIAL_PATTERNS: [RegExp, string][] = [
  [/^\/esc\s*$/i, "ESC key"],
  [/^\/enter\s*$/i, "Enter key"],
  [/^\/interrupt\s*$/i, "Interrupt key"],
  [/^\/up\s*$/i, "Up arrow"],
  [/^\/down\s*$/i, "Down arrow"],
  [/^\/exit\s*$/i, "/exit command to claude"],
  [/^\/new\s*$/i, "/new command to claude"],
  [/^\/clear\s*$/i, "/clear command to claude"],
  [/^\/status\s*$/i, "/status command to claude"],
  [/^claude(?:-[a-z]+)?\b/i, "claude CLI command"],
];

export function validateCommand(command: string): ValidationResult {
  const trimmed = command.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty command" };
  }

  for (const [pattern] of SPECIAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "command not allowed — use /esc · /enter · /interrupt · /up · /down · /exit · /new · /clear · /status · claude-*" };
}
