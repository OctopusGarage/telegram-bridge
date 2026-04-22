// Security: whitelist-only command validation
// Only these patterns are allowed through /run <cmd>

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

// Only these command patterns are allowed
export const SPECIAL_PATTERNS: [RegExp, string][] = [
  [/^claude(?:-[a-z]+)?$/i, "claude CLI command (no extra args)"],
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

  return { ok: false, reason: "command not allowed — use /esc · /enter · /interrupt · /up · /down · /exit · /new · /clear · or /run claude-<name> (no extra args)" };
}
