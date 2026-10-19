import "server-only";
import { loadCapState } from "@/lib/apply/state";
import { db } from "@/lib/db";

/** What the pipeline did in the last 24 hours. Each count is read on its own, so one failing read never hides the others. */
export async function last24h(threshold: number, now: Date = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const count = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0, () => 0);
  const [found, scored, matched, prepared, state] = await Promise.all([
    count(db().from("jobs").select("id", { count: "exact", head: true }).gte("found_at", since)),
    count(db().from("job_scores").select("id", { count: "exact", head: true }).gte("created_at", since)),
    count(db().from("job_scores").select("id", { count: "exact", head: true }).gte("created_at", since).gte("score", threshold)),
    count(db().from("applications").select("id", { count: "exact", head: true }).gte("created_at", since)),
    loadCapState().catch(() => ({ automatedToday: 0 })),
  ]);
  return { found, scored, matched, prepared, sentAutomatically: state.automatedToday };
}
