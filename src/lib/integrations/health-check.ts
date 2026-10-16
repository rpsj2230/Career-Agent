import "server-only";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { sendTelegram } from "@/lib/notify";
import { staleAlerts } from "./health";
import { loadPortalsView } from "./view";

/**
 * Hourly check (from the tick): tell you about sources that are set up but have not scanned successfully for days.
 * Each source is reminded about at most once a day. Never throws.
 */
export async function checkStaleSources(now = new Date()): Promise<{ id: string; message: string }[]> {
  try {
    const view = await loadPortalsView();
    if (view.schemaMissing) return [];
    const rows = view.integrations
      .filter((i) => i.def.discovers && i.def.available)
      .map((i) => ({
        id: i.def.id, name: i.def.name, enabled: i.state?.enabled ?? true,
        ready: !["needs_setup", "planned", "disabled"].includes(i.status),
        last_scan_at: i.state?.last_scan_at ?? null, last_ok_at: i.state?.last_ok_at ?? null,
        stale_alerted_at: ((i.state as { config?: { stale_alerted_at?: string } } | undefined)?.config?.stale_alerted_at) ?? null,
      }));
    const alerts = staleAlerts(rows, now);
    for (const a of alerts) {
      await sendTelegram(a.message);
      await logActivity({ kind: "integration.error", level: "warn", message: a.message.split("\n")[0], integration: a.id, status: "stale", detail: { reminder: true } });
      const cur = (await db().from("integrations").select("config").eq("id", a.id).maybeSingle()).data as { config?: Record<string, unknown> } | null;
      await db().from("integrations").update({ config: { ...(cur?.config ?? {}), stale_alerted_at: now.toISOString() } }).eq("id", a.id);
    }
    return alerts;
  } catch (e) {
    console.error(`[health] stale-source check failed: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}
