import { homedir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { expandTilde } from "../../src/utils/path.js";

describe("expandTilde", () => {
  it("expands bare ~ to the home directory", () => {
    expect(expandTilde("~")).toBe(homedir());
  });

  it("expands ~/<suffix> while preserving suffix", () => {
    expect(expandTilde("~/code")).toBe(path.join(homedir(), "code"));
  });

  it("does not expand tilde appearing in non-leading positions", () => {
    expect(expandTilde("/srv/~archive")).toBe("/srv/~archive");
  });

  it("does not expand ~user style prefixes", () => {
    expect(expandTilde("~alice/repo")).toBe("~alice/repo");
  });
});
