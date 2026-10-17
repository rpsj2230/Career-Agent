import "server-only";
import { db, must } from "@/lib/db";

export type Caps = {
  daily_total: number;
  daily_linkedin: number;
  weekly_linkedin: number;
  linkedin_automation_enabled: boolean;
};

export const DEFAULTS = {
  discovery: { countries: ["in"], roles: [] as string[], greenhouse_boards: [] as string[], lever_companies: [] as string[], max_age_days: 14 },
  scoring: { threshold: 65 },
  /** reuse or adapt resumes made for similar jobs instead of writing each from scratch */
  tailoring: { reuse_enabled: true, reuse_similarity: 0.85, adapt_similarity: 0.4 },
  caps: { daily_total: 15, daily_linkedin: 10, weekly_linkedin: 40, linkedin_automation_enabled: false } as Caps,
};

export async function getSetting<K extends keyof typeof DEFAULTS>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const row = must<{ value: unknown } | null>(await db().from("settings").select("value").eq("key", key).maybeSingle(), `load setting ${key}`);
  return { ...DEFAULTS[key], ...((row?.value as object) ?? {}) } as (typeof DEFAULTS)[K];
}

export async function putSetting(key: string, value: unknown) {
  must(await db().from("settings").upsert({ key, value, updated_at: new Date().toISOString() }).select(), `save setting ${key}`);
}
