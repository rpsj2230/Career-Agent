/** The checks behind `npm run assist:check`: pure, so they can be tested without a browser or a database. */
export type CheckInput = {
  hasUrl: boolean; hasKey: boolean; dbOk: boolean; dbError?: string;
  heartbeatAgeMs: number | null; watching: boolean;
  autoApplyOn: boolean; localAutoOn: boolean;
  waiting: number; chromiumFound: boolean; profileExists: boolean;
  /** the portals the watcher found the assistant's browser signed in to on its last round (null: it has not said) */
  signedIn?: string[] | null;
  /** the local AI model on this computer: the name in LOCAL_MODEL (null: not set), whether Ollama answered, and whether that model is downloaded (undefined: not asked, for example in older tests) */
  localModel?: { name: string | null; ollamaReachable: boolean; downloaded: boolean };
};
export type CheckLine = { ok: boolean; label: string; fix?: string };

export function assistChecks(i: CheckInput): CheckLine[] {
  const out: CheckLine[] = [];
  out.push({ ok: i.hasUrl && i.hasKey, label: "Settings found (.env.local has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)", fix: "Create .env.local in the project folder with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the same values as in Vercel)." });
  out.push({ ok: i.dbOk, label: "Can reach the Career Agent database", fix: i.dbError ? `The database said: ${i.dbError}` : "Check your internet connection and the two values in .env.local." });
  out.push({ ok: i.chromiumFound, label: "The browser the assistant uses is installed", fix: "Run: npx playwright install chromium" });
  out.push({ ok: i.profileExists, label: "The assistant's browser profile exists (this alone does not prove you are signed in)", fix: "Run: npm run assist:login, then sign in to LinkedIn, Naukri and Indeed in the window that opens, and close the window. The sessions are kept." });
  if (i.signedIn) out.push({ ok: i.signedIn.includes("linkedin"), label: i.signedIn.includes("linkedin") ? "The assistant's browser is signed in to LinkedIn" : "The assistant's browser is NOT signed in to LinkedIn, so LinkedIn jobs show no Easy Apply button", fix: "Run: npm run assist:login, sign in to LinkedIn in the window that opens (solve any security check yourself), then close the window." });
  if (i.localModel) {
    const m = i.localModel;
    if (!m.name) out.push({ ok: false, label: "No local AI model on this computer: when the free hosted models run out, the assistant cannot answer a new form question and hands the application back", fix: "Install the Ollama app (ollama.com), then run: bash scripts/setup-local-model.sh   (it ends with WORKING or NOT WORKING), then restart the assistant: bash scripts/autostart/install.sh" });
    else if (!m.ollamaReachable) out.push({ ok: false, label: `The local AI model (${m.name}) is set, but Ollama is not running`, fix: "Open the Ollama app and keep it open (Ollama's own setting 'Launch at login' keeps it running after a restart), then run this check again." });
    else if (!m.downloaded) out.push({ ok: false, label: `The local AI model (${m.name}) is not downloaded yet (Ollama is running)`, fix: `Run: ollama pull ${m.name}` });
    else out.push({ ok: true, label: `The local AI model (${m.name}) is ready: it answers when every hosted model has failed` });
  }
  out.push({ ok: i.autoApplyOn, label: "Auto-Apply is switched on (Settings → Auto-Apply)", fix: "Without it the assistant only fills forms and waits for you to press Submit." });
  out.push({ ok: i.localAutoOn, label: "Hands-free mode is switched on (Settings → Application limits)", fix: "Without it the background watcher does nothing; `npm run assist` still works when you run it by hand." });
  const alive = i.heartbeatAgeMs !== null && i.heartbeatAgeMs < 3 * 60_000;
  out.push({ ok: alive && i.watching, label: alive && i.watching ? "The background watcher is running and reporting in" : i.heartbeatAgeMs === null ? "The background watcher has never reported in" : "The background watcher is not running now (last seen " + Math.round(i.heartbeatAgeMs / 60_000) + " min ago)", fix: "Start it once with: npm run assist:watch, and install the autostart so it starts when you sign in (docs/ASSISTANT_AUTOSTART.md)." });
  out.push({ ok: true, label: `${i.waiting} application${i.waiting === 1 ? " is" : "s are"} waiting for the assistant` });
  return out;
}
