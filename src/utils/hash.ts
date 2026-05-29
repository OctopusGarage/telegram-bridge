import { createHash } from "node:crypto";

const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function sessionShortId(sessionName: string): string {
  const hash = createHash("sha256").update(sessionName).digest();

  let num = 0;
  for (let i = 0; i < 4; i++) {
    num = num * 256 + hash[i]!;
  }

  let result = "";
  while (num > 0) {
    result = BASE62[num % 62] + result;
    num = Math.floor(num / 62);
  }

  return result.padStart(6, "0").slice(0, 6);
}
