/**
 * Checks that the apply assistant is ready on this computer and that the website can reach it:  npm run assist:check
 * It changes nothing. Each failed line says how to fix it.
 */
import { existsSync } from "node:fs";
import { asAssistantProfile, browserDirFor, type Who } from "./assist-profile";
import { scopedDb } from "../src/lib/scoped-db";
import { browserFromMachine } from "./browser";
import { chromium } from "playwright";
import { assistChecks } from "./assist-check-lib";

async function main(who: Who | null) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let dbOk = false, dbError: string | undefined, hb = null as { at?: string; watching?: boolean; signedIn?: string[] } | null, autoApplyOn = false, localAutoOn = false, waiting = 0;
  if (url && key) {
    const sb = scopedDb();
    try {
      const get = async (k: string) => (await sb.from("settings").select("value").eq("key", k).maybeSingle());
      const [h, a, c, w] = await Promise.all([get("assistant_heartbeat"), get("autoapply"), get("caps"), sb.from("applications").select("id", { count: "exact", head: true }).eq("status", "assisted_pending")]);
      if (h.error) throw new Error(h.error.message);
      dbOk = true;
      hb = (h.data?.value as { at?: string; watching?: boolean; signedIn?: string[] } | null) ?? null;
      autoApplyOn = (a.data?.value as { enabled?: boolean } | null)?.enabled === true;
      localAutoOn = (c.data?.value as { local_auto_enabled?: boolean } | null)?.local_auto_enabled === true;
      waiting = w.count ?? 0;
    } catch (e) { dbError = e instanceof Error ? e.message : String(e); }
  }
  let chromiumFound = false;
  try { const b = browserFromMachine(); chromiumFound = b.executablePath ? existsSync(b.executablePath) : b.channel ? true : existsSync(chromium.executablePath()); } catch { /* not installed or not found */ }
  const localName = process.env.LOCAL_MODEL?.trim() || null;
  let ollamaReachable = false, downloaded = false;
  try {
    const res = await fetch(`${(process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "")}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      ollamaReachable = true;
      const names = ((await res.json()) as { models?: { name?: string }[] }).models?.map((m) => m.name ?? "") ?? [];
      downloaded = !!localName && names.some((n) => n === localName || n === `${localName}:latest`);
    }
  } catch { /* Ollama is not running */ }
  const profileDir = browserDirFor(who);
  const lines = assistChecks({
    hasUrl: !!url, hasKey: !!key, dbOk, dbError, heartbeatAgeMs: hb?.at ? Date.now() - new Date(hb.at).getTime() : null, watching: !!hb?.watching,
    autoApplyOn, localAutoOn, waiting, chromiumFound, profileExists: existsSync(profileDir), signedIn: hb?.signedIn ?? null,
    localModel: { name: localName, ollamaReachable, downloaded },
  });
  for (const l of lines) console.log(`${l.ok ? "  OK   " : "  FIX  "} ${l.label}${l.ok || !l.fix ? "" : `\n         → ${l.fix}`}`);
  const bad = lines.filter((l) => !l.ok).length;
  console.log(bad ? `\n${bad} thing(s) to fix. The first two decide whether anything works; the rest decide whether it runs by itself.` : "\nEverything is ready. Press \"Apply with assistant\" on the Applications page and the assistant starts within about 30 seconds.");
  process.exit(bad ? 1 : 0);
}
asAssistantProfile((who) => main(who)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
