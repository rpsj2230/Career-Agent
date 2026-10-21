import { NextResponse } from "next/server";
import { z } from "zod";
import { ApifySettings } from "@/lib/jobs/apify";
import { STYLES } from "@/lib/tailor/template";
import { putSetting } from "@/lib/settings";
import { logConfig } from "@/lib/activity-helpers";

const list = z.array(z.string().trim().min(1).max(80)).max(50);
const Schemas = {
  discovery: z.object({
    countries: z.array(z.string().length(2).transform((c) => c.toLowerCase())).max(30),
    roles: list, greenhouse_boards: list, lever_companies: list, ashby_orgs: list.default([]), workable_accounts: list.default([]), recruitee_companies: list.default([]), max_age_days: z.number().int().min(1).max(90), min_rescan_hours: z.number().int().min(0).max(168).default(6),
  }),
  scoring: z.object({ threshold: z.number().int().min(0).max(100), min_evidence: z.number().int().min(0).max(60).default(20), batch_size: z.number().int().min(1).max(8).default(5), routing: z.boolean().default(true), escalate_borderline: z.boolean().default(true), learning: z.boolean().default(true) }),
  tailoring: z.object({ reuse_enabled: z.boolean(), reuse_similarity: z.number().min(0.5).max(1), adapt_similarity: z.number().min(0.1).max(0.9) })
    .refine((t) => t.adapt_similarity < t.reuse_similarity, "The adapt level must be lower than the reuse level"),
  tailoring_scope: z.object({ headline: z.boolean(), summary: z.boolean(), highlights: z.boolean().default(true), bullets: z.boolean(), skills: z.boolean() }),
  retention: z.object({ skipped_days: z.number().int().min(0).max(3650), log_days: z.number().int().min(0).max(3650) }),
  resume_templates: z.record(z.string().regex(/^[a-z]{2}$/), z.enum(STYLES.map((x) => x.id) as [string, ...string[]])),
  replies: z.object({ enabled: z.boolean() }),
  blocklist: z.object({ companies: list.default([]), keywords: list.default([]), skip_agencies: z.boolean().default(false) }),
  apify: ApifySettings,
  watchlist: z.object({ enabled: z.boolean(), boards: z.record(z.string(), z.array(z.string().max(80)).max(300)), added: z.record(z.string(), z.string()).default({}) }),
  autoapply: z.object({ enabled: z.boolean() }),
  automation_pause: z.object({ paused: z.boolean(), since: z.string().max(40).default(""), until: z.string().max(40).default(""), note: z.string().max(200).default("") }),
  auto_prepare: z.object({ enabled: z.boolean(), per_run: z.number().int().min(0).max(40), concurrency: z.number().int().min(1).max(8).default(3) }),
  email_apply: z.object({ enabled: z.boolean(), also_when_listed: z.boolean(), daily_cap: z.number().int().min(0).max(100) }),
  local_model: z.object({ mode: z.enum(["off", "when_needed", "always"]), model: z.string().regex(/^[\w.:-]{2,60}$/, "Use a model name such as qwen2.5:3b-instruct") }),
  delivery: z.object({ enabled: z.boolean(), hour: z.number().int().min(0).max(23), telegram: z.boolean(), email: z.boolean(), to: z.string().trim().max(200).refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email address or leave it empty") }),
  caps: z.object({
    daily_total: z.number().int().min(0).max(100), daily_linkedin: z.number().int().min(0).max(50),
    weekly_linkedin: z.number().int().min(0).max(200), linkedin_automation_enabled: z.boolean(), local_auto_enabled: z.boolean().default(false), company_cooldown_days: z.number().int().min(0).max(365).default(14),
  }),
} as const;

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { key?: keyof typeof Schemas; value?: unknown } | null;
  const schema = body?.key && Schemas[body.key];
  if (!schema) return NextResponse.json({ error: "Unknown setting" }, { status: 400 });
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  await putSetting(body.key!, parsed.data);
  await logConfig(`Settings changed: ${body.key}`, { key: body.key, value: parsed.data });
  return NextResponse.json({ ok: true });
}
