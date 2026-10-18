import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";

export type Retention = { skipped_days: number; log_days: number };

/**
 * Keep the database small when thousands of postings are scanned. Nothing that matters is lost:
 *  - a skipped job keeps its title, company, link, score, reason and de-duplication key forever (so it is never fetched or
 *    scored twice); only its long description is cleared once it is older than `skipped_days`;
 *  - the per-job "rejected" log lines older than `log_days` are deleted (the totals live on each run's record).
 * Jobs you saved or applied to, and everything about applications, are never touched. 0 turns a rule off.
 */
export async function applyRetention(now = new Date(), r?: Retention): Promise<{ trimmed: number; logsDeleted: number }> {
  const cfg = r ?? (await getSetting("retention"));
  const out = { trimmed: 0, logsDeleted: 0 };
  const before = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  if (cfg.skipped_days > 0) {
    const res = await db().from("jobs").update({ description: "" }, { count: "exact" }).eq("status", "skipped").lt("found_at", before(cfg.skipped_days)).neq("description", "");
    if (res.error) throw new Error(`trim skipped jobs: ${res.error.message}`);
    out.trimmed = res.count ?? 0;
  }
  if (cfg.log_days > 0) {
    const res = await db().from("activity_log").delete({ count: "exact" }).eq("kind", "job.rejected").lt("at", before(cfg.log_days));
    if (res.error) throw new Error(`trim rejection log: ${res.error.message}`);
    out.logsDeleted = res.count ?? 0;
  }
  return out;
}
