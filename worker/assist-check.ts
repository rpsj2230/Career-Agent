/**
 * Checks that the apply assistant is ready on this computer and that the website can reach it:  npm run assist:check
 * It changes nothing. Each failed line says how to fix it.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { assistChecks } from "./assist-check-lib";

async function main() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let dbOk = false, dbError: string | undefined, hb = null as { at?: string; watching?: boolean } | null, autoApplyOn = false, localAutoOn = false, waiting = 0;
  if (url && key) {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    try {
      const get = async (k: string) => (await sb.from("settings").select("value").eq("key", k).maybeSingle());
      const [h, a, c, w] = await Promise.all([get("assistant_heartbeat"), get("autoapply"), get("caps"), sb.from("applications").select("id", { count: "exact", head: true }).eq("status", "assisted_pending")]);
      if (h.error) throw new Error(h.error.message);
      dbOk = true;
      hb = (h.data?.value as { at?: string; watching?: boolean } | null) ?? null;
      autoApplyOn = (a.data?.value as { enabled?: boolean } | null)?.enabled === true;
      localAutoOn = (c.data?.value as { local_auto_enabled?: boolean } | null)?.local_auto_enabled === true;
      waiting = w.count ?? 0;
    } catch (e) { dbError = e instanceof Error ? e.message : String(e); }
  }
  let chromiumFound = false;
  try { chromiumFound = existsSync(process.env.CHROMIUM_PATH || chromium.executablePath()); } catch { /* not installed */ }
  const profileDir = process.env.ASSIST_PROFILE_DIR || join(homedir(), ".career-agent", "browser");
  const lines = assistChecks({
    hasUrl: !!url, hasKey: !!key, dbOk, dbError, heartbeatAgeMs: hb?.at ? Date.now() - new Date(hb.at).getTime() : null, watching: !!hb?.watching,
    autoApplyOn, localAutoOn, waiting, chromiumFound, profileExists: existsSync(profileDir),
  });
  for (const l of lines) console.log(`${l.ok ? "  OK   " : "  FIX  "} ${l.label}${l.ok || !l.fix ? "" : `\n         → ${l.fix}`}`);
  const bad = lines.filter((l) => !l.ok).length;
  console.log(bad ? `\n${bad} thing(s) to fix. The first two decide whether anything works; the rest decide whether it runs by itself.` : "\nEverything is ready. Press \"Apply with assistant\" on the Applications page and the assistant starts within about 30 seconds.");
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
