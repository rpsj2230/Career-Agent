import "server-only";
import { db, must } from "@/lib/db";
import type { NormalizedJob } from "./normalize";
import { planInsert } from "./plan";

export async function ingestJobs(jobs: NormalizedJob[], maxAgeDays: number) {
  const existing = new Set<string>();
  // page through existing keys; personal-scale data so a simple scan is fine
  for (let from = 0; ; from += 1000) {
    const page = must<{ dedupe_key: string }[]>(await db().from("jobs").select("dedupe_key").range(from, from + 999), "load existing jobs");
    page.forEach((r) => existing.add(r.dedupe_key));
    if (page.length < 1000) break;
  }
  const plan = planInsert(jobs, existing, maxAgeDays);
  if (plan.rows.length) {
    must(await db().from("jobs").upsert(plan.rows, { onConflict: "source,external_id", ignoreDuplicates: true }).select("id"), "insert jobs");
  }
  return { inserted: plan.rows.length, invalid: plan.invalid, stale: plan.stale, duplicates: plan.duplicates };
}
