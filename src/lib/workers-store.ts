import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { workersOverview, type Beat } from "@/lib/workers-overview";

/** Reads what the Workers panel shows. Each read is on its own, so one failing read leaves the rest of the panel intact. */
export async function loadWorkers(now = new Date()) {
  const beat = async (key: string): Promise<Beat> => {
    try { return ((await db().from("settings").select("value").eq("key", key).maybeSingle()).data?.value as Beat) ?? null; } catch { return null; }
  };
  const [computer, oracle, github, cloud] = await Promise.all([beat("assistant_heartbeat"), beat("worker_heartbeat:oracle"), beat("worker_heartbeat:github"), getSetting("cloud_assist").catch(() => ({ enabled: false, fallback_minutes: 90 }))]);
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const started: Record<string, number> = {}, declined: Record<string, number> = {};
  try {
    const ev = await db().from("apply_events").select("kind, detail").in("kind", ["worker_started", "worker_declined"]).gte("at", since).limit(2000);
    for (const e of (ev.data ?? []) as { kind: string; detail: { worker?: string } | null }[]) {
      const w = e.detail?.worker ?? "computer";
      (e.kind === "worker_started" ? started : declined)[w] = ((e.kind === "worker_started" ? started : declined)[w] ?? 0) + 1;
    }
  } catch { /* the counts are a courtesy */ }
  return { rows: workersOverview({ now, computer, oracle, github, cloud: { enabled: !!cloud.enabled, fallback_minutes: cloud.fallback_minutes ?? 90 }, started24h: started, declined24h: declined }), cloud: { enabled: !!cloud.enabled, fallback_minutes: cloud.fallback_minutes ?? 90 } };
}
