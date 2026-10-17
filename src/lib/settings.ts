import type { ApifyActor } from "@/lib/jobs/apify";
import "server-only";
import { db, must } from "@/lib/db";

export type Caps = {
  daily_total: number;
  daily_linkedin: number;
  weekly_linkedin: number;
  linkedin_automation_enabled: boolean;
  /** let the apply assistant on your computer press Submit by itself (within the caps); otherwise it stops for you */
  local_auto_enabled?: boolean;
};

export const DEFAULTS = {
  discovery: { countries: ["in"], roles: [] as string[], greenhouse_boards: [] as string[], lever_companies: [] as string[], max_age_days: 14 },
  /** threshold: minimum fit to queue a job; min_evidence: jobs the free rules rate below this are skipped without a model call */
  scoring: { threshold: 65, min_evidence: 20 },
  /** reuse or adapt resumes made for similar jobs instead of writing each from scratch */
  tailoring: { reuse_enabled: true, reuse_similarity: 0.85, adapt_similarity: 0.4 },
  /** keep the database small: clear the description of skipped jobs after N days; delete per-job rejection log lines after N days (0 = never) */
  retention: { skipped_days: 30, log_days: 90 },
  /** resume style per country code, e.g. { "de": "europe" }; countries not listed use the default for their region */
  resume_templates: {} as Record<string, string>,
  /** hosted scrapers (Apify) for the portals without an API */
  apify: { actors: [] as ApifyActor[] },
  caps: { daily_total: 15, daily_linkedin: 10, weekly_linkedin: 40, linkedin_automation_enabled: false, local_auto_enabled: false } as Caps,
};

export async function getSetting<K extends keyof typeof DEFAULTS>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const row = must<{ value: unknown } | null>(await db().from("settings").select("value").eq("key", key).maybeSingle(), `load setting ${key}`);
  return { ...DEFAULTS[key], ...((row?.value as object) ?? {}) } as (typeof DEFAULTS)[K];
}

export async function putSetting(key: string, value: unknown) {
  must(await db().from("settings").upsert({ key, value, updated_at: new Date().toISOString() }).select(), `save setting ${key}`);
}
