import { describe, expect, it } from "vitest";
import { chunkTelegramMessage, createOutputAccumulator } from "../src/services/output-buffer.js";

describe("chunkTelegramMessage", () => {
  it("splits long text without losing content", () => {
    const text = "a".repeat(12);

    expect(chunkTelegramMessage(text, 5)).toEqual(["aaaaa", "aaaaa", "aa"]);
  });
});

describe("createOutputAccumulator", () => {
  it("returns only new pane content", () => {
    const accumulator = createOutputAccumulator();

    expect(accumulator.next("hello")).toEqual(["hello"]);
    expect(accumulator.next("hello\nworld")).toEqual(["world"]);
  });
});
