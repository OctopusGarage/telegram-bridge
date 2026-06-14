import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../src/config.js";

const base = {
  BOT_TOKEN: "t",
  TMUX_SESSION: "default",
  CLAUDE_STARTUP_COMMAND: "/startup",
};

describe("loadConfig", () => {
  it("fills defaults for omitted optionals and parses ids", () => {
    const cfg = loadConfig({
      ...base,
      ALLOWED_USER_IDS: "1, 2,3 ,",
      ALLOWED_CWD_ROOTS: "/tmp,  /var",
      TMUX_WINDOW: "bad",
      TMUX_PANE: "-3",
    } as any);

    expect(cfg.proxyUrl).toBeUndefined();
    expect(cfg.pollIntervalMs).toBe(1200);
    expect(cfg.allowedUserIds).toEqual(new Set(["1", "2", "3"]));
    expect(cfg.allowedCwdRoots).toEqual(["/tmp", "/var"]);
    expect(cfg.tmuxTarget.window).toBe(0);
    expect(cfg.tmuxTarget.pane).toBe(0);
  });

  it("falls back for missing optional http proxy fields", () => {
    const cfg = loadConfig({
      ...base,
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
    } as any);

    expect(cfg.proxyUrl).toBeUndefined();
  });

  it("prefers HTTPS proxy when both proxies are set", () => {
    const cfg = loadConfig({
      ...base,
      HTTP_PROXY: "http://localhost:1080",
      HTTPS_PROXY: "https://localhost:2080",
    } as any);

    expect(cfg.proxyUrl).toBe("https://localhost:2080");
  });

  it("throws when required fields are missing", () => {
    expect(() => loadConfig({ TMUX_SESSION: "default", CLAUDE_STARTUP_COMMAND: "/startup" } as any)).toThrow();
  });

  it("expands tilde in ALLOWED_CWD_ROOTS", () => {
    const cfg = loadConfig({
      ...base,
      ALLOWED_CWD_ROOTS: `~ , ~/projects `,
    } as any);

    expect(cfg.allowedCwdRoots).toEqual([homedir(), path.join(homedir(), "projects")]);
  });

  it("deduplicates ALLOWED_CWD_ROOTS after normalization", () => {
    const cfg = loadConfig({
      ...base,
      ALLOWED_CWD_ROOTS: "~, ~/,~, ~/",
    } as any);

    expect(cfg.allowedCwdRoots).toEqual([homedir()]);
  });
});
