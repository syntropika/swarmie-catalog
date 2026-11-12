import { createHash } from "node:crypto";

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function stable(value: unknown): string {
  return `${JSON.stringify(
    value,
    (_, item: unknown) => {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        return Object.fromEntries(Object.entries(item).sort(([a], [b]) => compare(a, b)));
      }
      return item;
    },
    2,
  )}\n`;
}
export function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
