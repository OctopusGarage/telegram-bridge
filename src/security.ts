// Security: allowlist-only validation for commands sent via /run.
//
// A command is accepted only if it FULLY matches one of the operator-configured
// patterns (ALLOWED_RUN_PATTERNS). Fail closed: with no patterns configured,
// nothing is allowed. Patterns are case-insensitive regular expressions and are
// auto-anchored, so an unanchored pattern can never allow arbitrary extra input.

export type ValidationResult = { ok: true } | { ok: false; reason: string };

function compilePatterns(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(`^(?:${pattern})$`, "i"));
    } catch {
      // Skip invalid regex rather than letting it crash command handling.
    }
  }
  return compiled;
}

export function validateCommand(command: string, allowedPatterns: string[] = []): ValidationResult {
  const trimmed = command.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty command" };
  }

  const patterns = compilePatterns(allowedPatterns);
  if (patterns.length === 0) {
    return {
      ok: false,
      reason: "no commands are allowed — set ALLOWED_RUN_PATTERNS to permit specific commands",
    };
  }

  if (patterns.some((re) => re.test(trimmed))) {
    return { ok: true };
  }

  return { ok: false, reason: "command not allowed by ALLOWED_RUN_PATTERNS" };
}
