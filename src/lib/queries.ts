import "server-only";
import { db, must } from "@/lib/db";

export type JobListRow = {
  id: string; title: string; company: string; country: string | null; location: string | null; url: string;
  apply_type: string; status: string; found_at: string; skip_reason: string | null;
  job_scores: { score: number; detail: { summary: string } } | { score: number; detail: { summary: string } }[] | null;
};

export const scoreOf = (r: JobListRow) => (Array.isArray(r.job_scores) ? r.job_scores[0] : r.job_scores);

export async function listJobs(statuses: string[], limit = 200): Promise<JobListRow[]> {
  const rows = must<JobListRow[]>(
    await db().from("jobs").select("id,title,company,country,location,url,apply_type,status,found_at,skip_reason,job_scores(score,detail)").in("status", statuses).order("found_at", { ascending: false }).limit(limit),
    "list jobs",
  );
  return rows.sort((a, b) => (scoreOf(b)?.score ?? -1) - (scoreOf(a)?.score ?? -1));
}

export async function counts() {
  const c = async (status: string) =>
    (await db().from("jobs").select("id", { count: "exact", head: true }).eq("status", status)).count ?? 0;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [fresh, queued, prepared, applied, saved] = await Promise.all([c("new"), c("queued"), c("prepared"), c("applied"), c("saved")]);
  const sent7 = (await db().from("applications").select("id", { count: "exact", head: true }).eq("status", "submitted").gte("submitted_at", weekAgo)).count ?? 0;
  const failed = (await db().from("applications").select("id", { count: "exact", head: true }).in("status", ["failed", "needs_input"])).count ?? 0;
  return { fresh, queued, prepared, applied, saved, sent7, failed };
}
