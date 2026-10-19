import "server-only";
import { db } from "@/lib/db";
import { fetchAll } from "@/lib/fetch-all";
import { summariseApply, type AttemptRow } from "./stats";

/** Application outcomes of the last `days` days, by channel. Tolerates missing columns on an older database. */
export async function loadApplyStats(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const res = await fetchAll((a, b) => db().from("applications").select("status,method,error,portal,job:jobs(url,apply_type)").in("status", ["submitted", "needs_input", "failed"]).gte("created_at", since).order("id").range(a, b));
  if (res.error) return [];
  const rows: AttemptRow[] = (res.data as unknown as { status: string; method: string | null; error: string | null; portal: string | null; job: { url: string; apply_type: string } | { url: string; apply_type: string }[] | null }[])
    .map((r) => { const j = Array.isArray(r.job) ? r.job[0] : r.job; return { status: r.status, method: r.method, error: r.error, portal: r.portal, url: j?.url ?? null, apply_type: j?.apply_type ?? null }; });
  return summariseApply(rows);
}
