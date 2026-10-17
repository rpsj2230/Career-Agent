import "server-only";
import { db } from "@/lib/db";
import { buildStats, type Outcome, type OutcomeStats } from "./learning";

/** What happened to past jobs: interviews and offers (good); rejections and jobs you skipped by hand (not). Tolerates missing data. */
export async function loadOutcomeStats(): Promise<OutcomeStats> {
  const outcomes: Outcome[] = [];
  const apps = await db().from("applications").select("lifecycle, job:jobs(title,company)").in("lifecycle", ["interview", "offer", "rejected"]).limit(2000);
  if (!apps.error) {
    for (const a of apps.data as unknown as { lifecycle: string; job: { title: string; company: string } | { title: string; company: string }[] | null }[]) {
      const j = Array.isArray(a.job) ? a.job[0] : a.job;
      if (j) outcomes.push({ title: j.title, company: j.company, kind: a.lifecycle === "rejected" ? "negative" : "positive" });
    }
  }
  const skipped = await db().from("jobs").select("title,company,skip_reason").eq("status", "skipped").limit(3000);
  if (!skipped.error) {
    for (const j of skipped.data as { title: string; company: string; skip_reason: string | null }[]) {
      if (/^skipped by you/i.test(j.skip_reason ?? "")) outcomes.push({ title: j.title, company: j.company, kind: "negative" });
    }
  }
  return buildStats(outcomes);
}
