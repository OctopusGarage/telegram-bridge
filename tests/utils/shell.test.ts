import { describe, expect, it } from "vitest";
import { shellQuote } from "../../src/utils/shell.js";

describe("shellQuote", () => {
  it("wraps a plain value in single quotes", () => {
    expect(shellQuote("/home/user/projects")).toBe("'/home/user/projects'");
  });

  it("neutralizes command substitution and expansion", () => {
    // Single quotes suppress $(...), backticks, and $VAR — the quoted string is literal.
    expect(shellQuote("/tmp/$(touch pwned)")).toBe("'/tmp/$(touch pwned)'");
    expect(shellQuote("/tmp/`id`")).toBe("'/tmp/`id`'");
    expect(shellQuote("/tmp/$HOME")).toBe("'/tmp/$HOME'");
  });

  it("escapes embedded single quotes safely", () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
    // The result, when parsed by a POSIX shell, yields exactly the original string.
    expect(shellQuote("don't")).toBe("'don'\\''t'");
  });
});
