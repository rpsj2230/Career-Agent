import "server-only";
import { db, must } from "@/lib/db";
import { classifySchemaError } from "@/lib/schema";
import { logActivity } from "@/lib/activity";
import type { NormalizedJob } from "./normalize";
import { planInsert, type KnownJob, type Sighting } from "./plan";
import { portalLabel } from "./portal";

export type IngestCounts = { inserted: number; invalid: number; stale: number; duplicates: number; legacy?: boolean };

/**
 * Every stored job's dedupe key with its id, origin portal and other portals, loaded once per run so many scans share it.
 * Works before the database update too (then there is no portal information, and cross-portal sightings are simply not recorded).
 */
export async function loadKnownJobs(): Promise<Map<string, KnownJob>> {
  const known = new Map<string, KnownJob>();
  let cols = "id,dedupe_key,portal,seen_on";
  for (let from = 0; ; from += 1000) {
    let res = await db().from("jobs").select(cols).range(from, from + 999);
    if (res.error && classifySchemaError(res.error) !== "other") { cols = "id,dedupe_key"; res = await db().from("jobs").select(cols).range(from, from + 999); }
    const page = must<{ id: string; dedupe_key: string; portal?: string | null; seen_on?: string[] | null }[]>(res, "load existing jobs");
    page.forEach((r) => known.set(r.dedupe_key, { id: r.id, portal: r.portal ?? null, seen_on: r.seen_on ?? [] }));
    if (page.length < 1000) break;
  }
  return known;
}

/** All known dedupe keys (kept for callers that only need to know whether a job exists). */
export async function loadExistingKeys(): Promise<Set<string>> {
  return new Set((await loadKnownJobs()).keys());
}

/**
 * Insert one scan's jobs. `existing` is updated so the next scan in the same run sees these jobs and does not
 * insert them again. If the database has not been migrated yet, the new columns are left out and `legacy` is set,
 * so discovery keeps working while the System page asks for the update.
 */
export async function ingestScan(jobs: NormalizedJob[], o: { maxAgeDays: number; existing: Set<string>; known?: Map<string, KnownJob>; scanId?: string | null; runId?: string | null }): Promise<IngestCounts> {
  const known = o.known ?? new Map<string, KnownJob>();
  const plan = planInsert(jobs, o.existing, o.maxAgeDays, new Date(), known);
  const counts: IngestCounts = { inserted: 0, invalid: plan.invalid, stale: plan.stale, duplicates: plan.duplicates };

  if (plan.rows.length > 0) {
    const full = plan.rows.map((r) => ({ ...r, scan_id: o.scanId ?? null, run_id: o.runId ?? null }));
    let res = await db().from("jobs").upsert(full, { onConflict: "source,external_id", ignoreDuplicates: true }).select("id");
    if (res.error && classifySchemaError(res.error) !== "other") {
      // the database has not been migrated: leave out every column added by migration 0002
      const legacy = plan.rows.map((r) => { const { portal, seen_on, salary_min, salary_max, salary_currency, salary_estimated, ...rest } = r; void [portal, seen_on, salary_min, salary_max, salary_currency, salary_estimated]; return rest; });
      res = await db().from("jobs").upsert(legacy, { onConflict: "source,external_id", ignoreDuplicates: true }).select("id");
      counts.legacy = true;
    }
    if (res.error) throw new Error(`insert jobs: ${res.error.message}`);
    plan.rows.forEach((r) => o.existing.add(r.dedupe_key));
    counts.inserted = plan.rows.length;
    if (!counts.legacy) await remember(plan.rows.map((r) => r.dedupe_key), known);
  }

  if (!counts.legacy) await recordSightings(plan.sightings, known, o.runId ?? null, o.scanId ?? null);
  return counts;
}

/** Learn the ids of jobs just inserted, so a later scan in the same run can record them being found elsewhere. */
async function remember(keys: string[], known: Map<string, KnownJob>) {
  const res = await db().from("jobs").select("id,dedupe_key,portal,seen_on").in("dedupe_key", keys);
  if (res.error) return; // only costs a missed cross-portal note; the job itself is stored
  for (const r of res.data as { id: string; dedupe_key: string; portal: string | null; seen_on: string[] | null }[]) known.set(r.dedupe_key, { id: r.id, portal: r.portal, seen_on: r.seen_on ?? [] });
}

/** Record that a stored posting was also found on another portal: a column on the job and one log entry (once per portal). */
async function recordSightings(sightings: Sighting[], known: Map<string, KnownJob>, runId: string | null, scanId: string | null) {
  for (const s of sightings) {
    const k = known.get(s.key);
    if (!k || k.seen_on.includes(s.portal)) continue;
    const seenOn = [...k.seen_on, s.portal];
    const { error } = await db().from("jobs").update({ seen_on: seenOn }).eq("id", s.jobId);
    if (error) { console.error(`[ingest] could not record that ${s.title} was also found on ${s.portal}: ${error.message}`); continue; }
    k.seen_on = seenOn;
    await logActivity({
      kind: "job.duplicate", message: `Already stored, also listed on ${portalLabel(s.portal)}: ${s.title} at ${s.company} (first found on ${portalLabel(s.primaryPortal)})`,
      run_id: runId, scan_id: scanId, job_id: s.jobId, company: s.company, country: s.country, portal: s.portal, status: "duplicate",
      detail: { title: s.title, first_portal: s.primaryPortal, also_on: s.portal, via: s.source },
    });
  }
}

/** Single-batch convenience used by manual add. */
export async function ingestJobs(jobs: NormalizedJob[], maxAgeDays: number) {
  const known = await loadKnownJobs();
  return ingestScan(jobs, { maxAgeDays, existing: new Set(known.keys()), known });
}
