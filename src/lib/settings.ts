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
  /** automatic approval waits this many days after an application to the same company (0 = no wait); you can still approve by hand */
  company_cooldown_days?: number;
};

export const DEFAULTS = {
  discovery: { countries: ["in"], roles: [] as string[], greenhouse_boards: [] as string[], lever_companies: [] as string[], ashby_orgs: [] as string[], workable_accounts: [] as string[], recruitee_companies: [] as string[], max_age_days: 30, min_rescan_hours: 6 },
  /** threshold: minimum fit to queue a job; min_evidence: jobs the free rules rate below this are skipped without a model call */
  scoring: { threshold: 65, min_evidence: 20, batch_size: 5, routing: true, escalate_borderline: true, learning: true },
  /** reuse or adapt resumes made for similar jobs instead of writing each from scratch */
  tailoring: { reuse_enabled: true, reuse_similarity: 0.85, adapt_similarity: 0.4 },
  /** which parts of your resume the agent may change for each job; the rest always stays as in your master resume */
  tailoring_scope: { headline: true, summary: true, highlights: true, bullets: true, skills: true },
  /** keep the database small: clear the description of skipped jobs after N days; delete per-job rejection log lines after N days (0 = never) */
  retention: { skipped_days: 30, log_days: 90, /** days the employer's confirmation picture is kept as proof after sending (0 = delete at once) */ screenshot_days: 14 },
  /** resume style per country code, e.g. { "de": "europe" }; countries not listed use the default for their region */
  resume_templates: {} as Record<string, string>,
  /** read your mailbox (read-only, in memory) to update applications when an employer replies; off until you turn it on */
  replies: { enabled: false },
  /** the resume file you uploaded, kept as the fallback when a tailored resume cannot be made (null until you upload one) */
  master_resume: null as { path: string; name: string; size: number; uploaded_at: string } | null,
  /** never show these: company names, words in the title or description, and (optionally) recruitment agencies */
  blocklist: { companies: [] as string[], keywords: [] as string[], skip_agencies: false },
  /** companies found posting matching jobs, whose own boards are read directly (see jobs/ats.ts) */
  watchlist: { enabled: true, boards: { greenhouse: [], lever: [], ashby: [], workable: [], recruitee: [] } as Record<string, string[]>, added: {} as Record<string, string> },
  /** hosted scrapers (Apify) for the portals without an API */
  apify: { actors: [] as ApifyActor[], monthly_item_budget: 2500 },
  /** last-resort model that runs for free on the GitHub runner when every hosted model fails: off, only when needed (default), or always */
  automation_pause: { paused: false, since: "", until: "", note: "" },
  /** the browser extension's link: a hash of its secret (never the secret itself) and when it was made */
  extension_link: { hash: "", created_at: "" },
  /** the checkboxes ticked on the "Your to-do" page */
  todo_done: {} as Record<string, boolean>,
  auto_prepare: { enabled: true, per_run: 15, concurrency: 3 },
  email_apply: { enabled: true, also_when_listed: true, daily_cap: 20 },
  local_model_test: { at: "", ok: false, model: "", ms: 0, note: "", run_url: "" },
  local_model: { mode: "when_needed" as "off" | "when_needed" | "always", model: "qwen2.5:3b-instruct" },
  /** the morning message: yesterday's report, what each run did, and the health check, by Telegram and/or email */
  delivery: { enabled: true, hour: 8, telegram: true, email: true, to: "" },
  /** master switch for everything that submits without you pressing a button (schedules and the hands-free assistant). Off until you turn it on. */
  autoapply: { enabled: false },
  /** one switch that turns on everything needed to run without you: see lib/autopilot.ts */
  autopilot: { enabled: false, since: "" },
  /** employers' own pages are applied for by a GitHub runner (no sign-in needed), so they do not wait for your computer */
  cloud_assist: { enabled: false, fallback_minutes: 90 },
  caps: { daily_total: 15, daily_linkedin: 10, weekly_linkedin: 40, linkedin_automation_enabled: false, local_auto_enabled: false, company_cooldown_days: 14 } as Caps,
};

export async function getSetting<K extends keyof typeof DEFAULTS>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const row = must<{ value: unknown } | null>(await db().from("settings").select("value").eq("key", key).maybeSingle(), `load setting ${key}`);
  return { ...DEFAULTS[key], ...((row?.value as object) ?? {}) } as (typeof DEFAULTS)[K];
}

export async function putSetting(key: string, value: unknown) {
  must(await db().from("settings").upsert({ key, value, updated_at: new Date().toISOString() }).select(), `save setting ${key}`);
}
