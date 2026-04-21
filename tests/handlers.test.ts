import { describe, expect, it } from "vitest";
import { parseRunCommand } from "../src/bot/handlers.js";

describe("parseRunCommand", () => {
  it("extracts the shell command after /run", () => {
    expect(parseRunCommand("/run ls -la")).toBe("ls -la");
  });

  it("supports bot-qualified commands", () => {
    expect(parseRunCommand("/run@bridge_bot echo hi")).toBe("echo hi");
  });

  it("returns null when the command is missing", () => {
    expect(parseRunCommand("/run")).toBeNull();
  });
});
