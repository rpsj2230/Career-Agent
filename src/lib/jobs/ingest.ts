import "server-only";
import { db, must } from "@/lib/db";
import { classifySchemaError } from "@/lib/schema";
import type { NormalizedJob } from "./normalize";
import { planInsert } from "./plan";

export type IngestCounts = { inserted: number; invalid: number; stale: number; duplicates: number; legacy?: boolean };

/** All known dedupe keys, loaded once per run so many scans can share them. */
export async function loadExistingKeys(): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const page = must<{ dedupe_key: string }[]>(await db().from("jobs").select("dedupe_key").range(from, from + 999), "load existing jobs");
    page.forEach((r) => existing.add(r.dedupe_key));
    if (page.length < 1000) break;
  }
  return existing;
}

/**
 * Insert one scan's jobs. `existing` is updated so the next scan in the same run sees these jobs and does not
 * insert them again. If the database has not been migrated yet, the new columns are left out and `legacy` is set,
 * so discovery keeps working while the System page asks for the update.
 */
export async function ingestScan(jobs: NormalizedJob[], o: { maxAgeDays: number; existing: Set<string>; scanId?: string | null; runId?: string | null }): Promise<IngestCounts> {
  const plan = planInsert(jobs, o.existing, o.maxAgeDays);
  const counts: IngestCounts = { inserted: 0, invalid: plan.invalid, stale: plan.stale, duplicates: plan.duplicates };
  if (plan.rows.length === 0) return counts;

  const full = plan.rows.map((r) => ({ ...r, scan_id: o.scanId ?? null, run_id: o.runId ?? null }));
  let res = await db().from("jobs").upsert(full, { onConflict: "source,external_id", ignoreDuplicates: true }).select("id");
  if (res.error && classifySchemaError(res.error) !== "other") {
    // the database has not been migrated: leave out every column added by migration 0002
    const legacy = plan.rows.map((r) => { const { portal, salary_min, salary_max, salary_currency, salary_estimated, ...rest } = r; void [portal, salary_min, salary_max, salary_currency, salary_estimated]; return rest; });
    res = await db().from("jobs").upsert(legacy, { onConflict: "source,external_id", ignoreDuplicates: true }).select("id");
    counts.legacy = true;
  }
  if (res.error) throw new Error(`insert jobs: ${res.error.message}`);
  plan.rows.forEach((r) => o.existing.add(r.dedupe_key));
  counts.inserted = plan.rows.length;
  return counts;
}

/** Single-batch convenience used by manual add. */
export async function ingestJobs(jobs: NormalizedJob[], maxAgeDays: number) {
  return ingestScan(jobs, { maxAgeDays, existing: await loadExistingKeys() });
}
