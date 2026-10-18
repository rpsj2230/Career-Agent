/** The checks behind `npm run assist:check`: pure, so they can be tested without a browser or a database. */
export type CheckInput = {
  hasUrl: boolean; hasKey: boolean; dbOk: boolean; dbError?: string;
  heartbeatAgeMs: number | null; watching: boolean;
  autoApplyOn: boolean; localAutoOn: boolean;
  waiting: number; chromiumFound: boolean; profileExists: boolean;
};
export type CheckLine = { ok: boolean; label: string; fix?: string };

export function assistChecks(i: CheckInput): CheckLine[] {
  const out: CheckLine[] = [];
  out.push({ ok: i.hasUrl && i.hasKey, label: "Settings found (.env.local has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)", fix: "Create .env.local in the project folder with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the same values as in Vercel)." });
  out.push({ ok: i.dbOk, label: "Can reach the Career Agent database", fix: i.dbError ? `The database said: ${i.dbError}` : "Check your internet connection and the two values in .env.local." });
  out.push({ ok: i.chromiumFound, label: "The browser the assistant uses is installed", fix: "Run: npx playwright install chromium" });
  out.push({ ok: i.profileExists, label: "You have signed in to your job portals in the assistant's browser at least once", fix: "Run: npm run assist:login, then sign in to LinkedIn, Naukri and Indeed in the window that opens, and close the window. The sessions are kept." });
  out.push({ ok: i.autoApplyOn, label: "Auto-Apply is switched on (Settings → Auto-Apply)", fix: "Without it the assistant only fills forms and waits for you to press Submit." });
  out.push({ ok: i.localAutoOn, label: "Hands-free mode is switched on (Settings → Application limits)", fix: "Without it the background watcher does nothing; `npm run assist` still works when you run it by hand." });
  const alive = i.heartbeatAgeMs !== null && i.heartbeatAgeMs < 3 * 60_000;
  out.push({ ok: alive && i.watching, label: alive && i.watching ? "The background watcher is running and reporting in" : i.heartbeatAgeMs === null ? "The background watcher has never reported in" : "The background watcher is not running now (last seen " + Math.round(i.heartbeatAgeMs / 60_000) + " min ago)", fix: "Start it once with: npm run assist:watch, and install the autostart so it starts when you sign in (docs/ASSISTANT_AUTOSTART.md)." });
  out.push({ ok: true, label: `${i.waiting} application${i.waiting === 1 ? " is" : "s are"} waiting for the assistant` });
  return out;
}
