import { homedir } from "node:os";
import * as path from "node:path";

export function expandTilde(input: string): string {
  if (input === "~") return homedir();
  if (input === "~/") return homedir();
  if (input.startsWith("~/")) return path.join(homedir(), input.slice(2));
  return input;
}
