import { parseLinkCode } from "../../src/lib/extension/link-code";
import { itemForPage } from "../../src/lib/extension/queue";

/** Small pure helpers the popup and the background worker share (built into lib.js as the global CareerAgentLib). */
const parts = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
/** Is `latest` a newer version than `current`? ("1.10.0" is newer than "1.9.0".) */
export function isNewer(latest: string | undefined, current: string): boolean {
  if (!latest) return false;
  const a = parts(latest), b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); }
  return false;
}

(globalThis as unknown as { CareerAgentLib: unknown }).CareerAgentLib = { parseLinkCode, itemForPage, isNewer };
