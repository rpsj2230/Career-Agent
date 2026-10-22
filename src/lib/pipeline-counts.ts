import "server-only";
import { db } from "@/lib/db";

type Counted = PromiseLike<{ count: number | null; error: { message: string } | null }>;
/** A count that could not be read is null (shown as "?"), never 0: a wrong query must not look like "nothing happened". */
const count = (q: Counted): Promise<number | null> => Promise.resolve(q).then((r) => (r.error ? null : r.count ?? 0), () => null);
const head = { count: "exact", head: true } as const;

/** What the pipeline did in the 24 hours before `now`, and what is waiting at each step. Each number is read on its own. */
export async function readPipelineCounts(now: Date, threshold: number) {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const jobs = (status: string) => count(db().from("jobs").select("id", head).eq("status", status));
  const apps = (statuses: string[]) => count(db().from("applications").select("id", head).in("status", statuses));
  const [found, scored, matched, prepared, approved, sent, toScore, toPrepare, toApprove, toSend, needsYou] = await Promise.all([
    count(db().from("jobs").select("id", head).gte("found_at", since)),
    count(db().from("job_scores").select("job_id", head).gte("created_at", since)),
    count(db().from("job_scores").select("job_id", head).gte("created_at", since).gte("score", threshold)),
    count(db().from("applications").select("id", head).gte("created_at", since)),
    count(db().from("applications").select("id", head).gte("approved_at", since)),
    count(db().from("applications").select("id", head).eq("status", "submitted").gte("submitted_at", since)),
    jobs("new"), jobs("queued"), apps(["prepared"]), apps(["approved", "submitting", "assisted_pending"]), apps(["needs_input"]),
  ]);
  return { last24h: { found, scored, matched, prepared, approved, sent }, waiting: { toScore, toPrepare, toApprove, toSend, needsYou } };
}
