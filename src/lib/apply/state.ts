import "server-only";
import { db, must } from "@/lib/db";
import { parseAtsUrl } from "@/lib/jobs/ats";
import { brokenAts, type Attempt, type CapState } from "./caps";

/** Counts automated applications approved today / this week (UTC), for cap enforcement. */
export async function loadCapState(): Promise<CapState> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const rows = must<{ approved_at: string; job: { apply_type: string } | { apply_type: string }[] | null }[]>(
    await db().from("applications").select("approved_at, job:jobs(apply_type)").eq("method", "automated").in("status", ["approved", "submitting", "submitted"]).gte("approved_at", weekAgo),
    "load cap state",
  );
  const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
  const typeOf = (r: (typeof rows)[number]) => (Array.isArray(r.job) ? r.job[0]?.apply_type : r.job?.apply_type);
  const today = rows.filter((r) => new Date(r.approved_at) >= midnight);
  const brokenOnes = await loadBrokenAts().catch(() => []);
  return {
    brokenAts: brokenOnes,
    automatedToday: today.length,
    linkedinAutomatedToday: today.filter((r) => typeOf(r) === "linkedin").length,
    linkedinAutomatedThisWeek: rows.filter((r) => typeOf(r) === "linkedin").length,
  };
}

/** Which ATS have failed technically on their last attempts (see brokenAts in caps.ts). */
async function loadBrokenAts(): Promise<string[]> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const res = await db().from("applications").select("approved_at,status,error,job:jobs(url,apply_type)").eq("method", "automated").in("status", ["submitted", "needs_input", "failed"]).gte("approved_at", since).limit(500);
  if (res.error) return [];
  const attempts: Attempt[] = [];
  for (const r of res.data as unknown as { approved_at: string; status: string; error: string | null; job: { url: string; apply_type: string } | { url: string; apply_type: string }[] | null }[]) {
    const j = Array.isArray(r.job) ? r.job[0] : r.job;
    const ats = (j && parseAtsUrl(j.url)?.ats) ?? (j && (j.apply_type === "greenhouse" || j.apply_type === "lever") ? j.apply_type : null);
    if (!ats) continue;
    attempts.push({ ats, at: r.approved_at, outcome: r.status === "submitted" ? "ok" : r.status === "needs_input" && /^Needs you:/i.test(r.error ?? "") ? "neutral" : "bad" });
  }
  return brokenAts(attempts);
}
