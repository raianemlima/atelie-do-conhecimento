import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stageInputHash(stage: string, version: string, inputKey: string): string {
  return sha256(`${stage}\u0000${version}\u0000${inputKey}`);
}
