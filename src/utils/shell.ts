/**
 * Quote an arbitrary string for safe use as a single POSIX shell argument.
 *
 * Wraps the value in single quotes (which suppress ALL shell expansion —
 * `$(...)`, backticks, `$VAR`, globbing) and escapes any embedded single quote
 * using the standard `'\''` idiom. Use this instead of JSON.stringify, whose
 * double quotes still allow command substitution.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
