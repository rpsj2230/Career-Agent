import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext } from "playwright";

type State = { cookies?: Parameters<BrowserContext["addCookies"]>[0]; origins?: { origin: string; localStorage?: { name: string; value: string }[] }[] };

/** Script that restores a site's local storage when a page of that site opens (cookies are set directly). */
export const localStorageScript = (origins: NonNullable<State["origins"]>): string =>
  `(() => { const all = ${JSON.stringify(origins.map((o) => ({ origin: o.origin, items: o.localStorage ?? [] })))}; const mine = all.find((o) => o.origin === location.origin); if (mine) for (const i of mine.items) { try { localStorage.setItem(i.name, i.value); } catch (e) {} } })();`;

/**
 * Sign-ins exported from your own computer (npm run assist:export) are loaded into this worker's browser once per exported file,
 * so a session the site refreshes later is not overwritten by the older copy every time the worker starts.
 */
export async function applyStorageState(context: BrowserContext, file: string | undefined, profileDir: string): Promise<boolean> {
  if (!file || !existsSync(file)) return false;
  const marker = join(profileDir, ".state-applied");
  const stamp = String(statSync(file).mtimeMs);
  const already = existsSync(marker) && readFileSync(marker, "utf8") === stamp;
  const state = JSON.parse(readFileSync(file, "utf8")) as State;
  if (state.origins?.length) await context.addInitScript({ content: localStorageScript(state.origins) });
  if (already) return true;
  if (state.cookies?.length) await context.addCookies(state.cookies);
  writeFileSync(marker, stamp);
  return true;
}
