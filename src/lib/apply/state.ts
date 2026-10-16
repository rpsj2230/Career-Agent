import "server-only";
import { db, must } from "@/lib/db";
import type { CapState } from "./caps";

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
  return {
    automatedToday: today.length,
    linkedinAutomatedToday: today.filter((r) => typeOf(r) === "linkedin").length,
    linkedinAutomatedThisWeek: rows.filter((r) => typeOf(r) === "linkedin").length,
  };
}
