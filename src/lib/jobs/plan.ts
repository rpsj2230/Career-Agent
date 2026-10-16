import { dedupeKey, detectApplyType, type ApplyType, type NormalizedJob } from "./normalize";
import { defaultCurrency } from "@/lib/countries";
import { normalizeSalary, parseSalaryText } from "@/lib/salary";
import { detectPortal } from "./portal";

export type JobInsert = {
  source: string; external_id: string; dedupe_key: string; title: string; company: string; country: string | null;
  location: string | null; url: string; description: string; salary_text: string | null; posted_at: string | null; apply_type: ApplyType;
  portal: string;
  salary_min: number | null; salary_max: number | null; salary_currency: string | null; salary_estimated: boolean;
};

/**
 * Decide which discovered jobs to insert: drop invalid or stale rows, collapse duplicates within
 * the batch, and skip anything whose dedupe key already exists in the database.
 */
export function planInsert(jobs: NormalizedJob[], existingKeys: Set<string>, maxAgeDays: number, now = new Date()) {
  const cutoff = now.getTime() - maxAgeDays * 86_400_000;
  const seen = new Set(existingKeys);
  const rows: JobInsert[] = [];
  let invalid = 0, stale = 0, duplicates = 0;
  for (const j of jobs) {
    if (!j.title?.trim() || !j.url?.startsWith("http") || !j.externalId) { invalid++; continue; }
    if (j.postedAt && new Date(j.postedAt).getTime() < cutoff) { stale++; continue; }
    const key = dedupeKey(j.company, j.title, j.country);
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    const sal = j.salary ? normalizeSalary(j.salary, j.country) : normalizeSalary(parseSalaryText(j.salaryText, defaultCurrency(j.country)), j.country);
    rows.push({
      source: j.source, external_id: j.externalId, dedupe_key: key, title: j.title.trim(), company: j.company.trim(),
      country: j.country ?? null, location: j.location ?? null, url: j.url, description: j.description ?? "",
      salary_text: j.salaryText ?? null, posted_at: j.postedAt ?? null, apply_type: detectApplyType(j.url),
      portal: detectPortal({ url: j.url, publisher: j.publisher, integration: j.source }),
      salary_min: sal.min, salary_max: sal.max, salary_currency: sal.currency, salary_estimated: !!j.salary?.estimated,
    });
  }
  return { rows, invalid, stale, duplicates };
}
