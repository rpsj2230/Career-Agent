import { dedupeKey, detectApplyType, type ApplyType, type NormalizedJob } from "./normalize";
import { defaultCurrency } from "@/lib/countries";
import { normalizeSalary, parseSalaryText } from "@/lib/salary";
import { detectPortal } from "./portal";

export type JobInsert = {
  source: string; external_id: string; dedupe_key: string; title: string; company: string; country: string | null;
  location: string | null; url: string; description: string; salary_text: string | null; posted_at: string | null; apply_type: ApplyType;
  portal: string;
  /** other portals this posting was also found on (cross-portal duplicates are merged, not stored twice) */
  seen_on: string[];
  salary_min: number | null; salary_max: number | null; salary_currency: string | null; salary_estimated: boolean;
};

/** What is already stored for a dedupe key, so a posting found on another portal can be recorded against it. */
export type KnownJob = { id: string; portal: string | null; seen_on: string[] };
/** A stored job found again on a different portal. */
export type Sighting = { jobId: string; key: string; portal: string; source: string; title: string; company: string; country: string | null; primaryPortal: string | null };

/**
 * Decide which discovered jobs to insert: drop invalid or stale rows, collapse duplicates within
 * the batch, and skip anything whose dedupe key already exists in the database. A duplicate found on a
 * different portal than the stored one is not lost: it is returned as a sighting (or added to the row's `seen_on`).
 */
export function planInsert(jobs: NormalizedJob[], existingKeys: Set<string>, maxAgeDays: number, now = new Date(), known: ReadonlyMap<string, KnownJob> = new Map()) {
  const cutoff = now.getTime() - maxAgeDays * 86_400_000;
  const seen = new Set(existingKeys);
  const rows: JobInsert[] = [];
  const byKey = new Map<string, JobInsert>();
  const sightings: Sighting[] = [];
  const sighted = new Set<string>();
  let invalid = 0, stale = 0, duplicates = 0;
  for (const j of jobs) {
    if (!j.title?.trim() || !j.url?.startsWith("http") || !j.externalId) { invalid++; continue; }
    if (j.postedAt && new Date(j.postedAt).getTime() < cutoff) { stale++; continue; }
    const key = dedupeKey(j.company, j.title, j.country);
    const portal = detectPortal({ url: j.url, publisher: j.publisher, integration: j.source });
    if (seen.has(key)) {
      duplicates++;
      const inBatch = byKey.get(key);
      if (inBatch) {
        if (portal !== inBatch.portal && !inBatch.seen_on.includes(portal)) inBatch.seen_on.push(portal);
      } else {
        const k = known.get(key);
        const id = `${key}|${portal}`;
        if (k && k.portal && portal !== k.portal && !k.seen_on.includes(portal) && !sighted.has(id)) {
          sighted.add(id);
          sightings.push({ jobId: k.id, key, portal, source: j.source, title: j.title.trim(), company: j.company.trim(), country: j.country ?? null, primaryPortal: k.portal });
        }
      }
      continue;
    }
    seen.add(key);
    const sal = j.salary ? normalizeSalary(j.salary, j.country) : normalizeSalary(parseSalaryText(j.salaryText, defaultCurrency(j.country)), j.country);
    const row: JobInsert = {
      source: j.source, external_id: j.externalId, dedupe_key: key, title: j.title.trim(), company: j.company.trim(),
      country: j.country ?? null, location: j.location ?? null, url: j.url, description: j.description ?? "",
      salary_text: j.salaryText ?? null, posted_at: j.postedAt ?? null, apply_type: detectApplyType(j.url),
      portal, seen_on: [],
      salary_min: sal.min, salary_max: sal.max, salary_currency: sal.currency, salary_estimated: !!j.salary?.estimated,
    };
    rows.push(row);
    byKey.set(key, row);
  }
  return { rows, invalid, stale, duplicates, sightings };
}
