import "server-only";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { jobLogFields } from "@/lib/activity-helpers";
import { recentCompanyApplication } from "@/lib/apply/cooldown";
import { logEvent } from "@/lib/apply/events";
import { markSubmitted } from "@/lib/apply/mark-submitted";
import { db, must } from "@/lib/db";
import { dedupeKey, detectApplyType, guessCountry } from "@/lib/jobs/normalize";
import { detectPortal } from "@/lib/jobs/portal";
import { withLegacyFallback } from "@/lib/schema";
import { getSetting } from "@/lib/settings";
import { autoSubmitState } from "./claim";
import { duplicateVerdict, externalAllowed, remainingFor, type ExternalLimits, type ExternalPortal } from "./external-rules";

export const ExternalJob = z.object({
  portal: z.enum(["linkedin", "naukri"]),
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  url: z.string().url().max(1000),
  /** the portal's own id for the job (the number in a LinkedIn or Naukri job link) */
  jobKey: z.string().trim().max(60).default(""),
  location: z.string().trim().max(200).optional(),
});
export type ExternalJob = z.infer<typeof ExternalJob>;

export type ExternalResult = { ok: true; remaining?: number } | { ok: false; status: number; error: string; global?: boolean };

const weekAgo = (now: Date) => new Date(now.getTime() - 7 * 86_400_000);
const midnightUtc = (now: Date) => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d; };

/** Auto-Apply state plus the LinkedIn counts, for the rules and for the popup's "N more allowed". */
export async function externalLimits(now = new Date()): Promise<ExternalLimits> {
  const [auto, caps] = await Promise.all([autoSubmitState(now), getSetting("caps")]);
  const res = await db().from("applications").select("submitted_at, job:jobs(portal, apply_type)").eq("status", "submitted").gte("submitted_at", weekAgo(now).toISOString()).limit(2000);
  const rows = res.error ? [] : (res.data as unknown as { submitted_at: string; job: { portal: string | null; apply_type: string | null } | { portal: string | null; apply_type: string | null }[] | null }[]);
  const onLinkedin = rows.filter((r) => { const j = Array.isArray(r.job) ? r.job[0] : r.job; return j?.portal === "linkedin" || j?.apply_type === "linkedin"; });
  return {
    auto, linkedinEnabled: !!caps.linkedin_automation_enabled, dailyLinkedin: caps.daily_linkedin ?? 10, weeklyLinkedin: caps.weekly_linkedin ?? 40,
    linkedinToday: onLinkedin.filter((r) => new Date(r.submitted_at) >= midnightUtc(now)).length, linkedinWeek: onLinkedin.length,
  };
}

/** What the popup shows before a run: may it run, why not, and how many applications more. */
export async function externalSummary(now = new Date()) {
  const l = await externalLimits(now);
  const one = (p: ExternalPortal) => { const v = externalAllowed(p, l); return { allowed: v.ok, why: v.ok ? null : v.why, remaining: remainingFor(p, l) }; };
  return { linkedin: one("linkedin"), naukri: one("naukri") };
}

type JobRow = { id: string };
/** The stored job this is, if any: by the portal's own id in the link (a scan stored it), else by company, title and country. */
async function findJob(j: ExternalJob): Promise<JobRow | null> {
  const key = dedupeKey(j.company, j.title, guessCountry(j.location));
  if (j.jobKey.length >= 6) {
    const byUrl = await db().from("jobs").select("id").ilike("url", `%${j.jobKey.replace(/[%_]/g, "")}%`).limit(1);
    if (!byUrl.error && byUrl.data?.length) return byUrl.data[0] as JobRow;
  }
  const byKey = await db().from("jobs").select("id").eq("dedupe_key", key).limit(1);
  if (!byKey.error && byKey.data?.length) return byKey.data[0] as JobRow;
  return null;
}

async function applicationOf(jobId: string) {
  return must<{ id: string; status: string } | null>(await db().from("applications").select("id,status").eq("job_id", jobId).maybeSingle(), "load application");
}

/** May the extension send this job now? The same switch, pause and limits as every automatic send, LinkedIn's own limits, no second application to a company inside the cool-down, and no job Career Agent already sent. */
export async function checkExternal(j: ExternalJob, now = new Date()): Promise<ExternalResult> {
  const limits = await externalLimits(now);
  const verdict = externalAllowed(j.portal as ExternalPortal, limits);
  if (!verdict.ok) return { ok: false, status: 409, error: verdict.why, global: verdict.global };
  const stored = await findJob(j);
  const app = stored ? await applicationOf(stored.id) : null;
  const dup = duplicateVerdict(app);
  if (!dup.ok) return { ok: false, status: 409, error: dup.why };
  const caps = await getSetting("caps");
  const recent = await recentCompanyApplication(j.company, caps.company_cooldown_days ?? 14, app?.id ?? "", now);
  if (recent) return { ok: false, status: 409, error: `You applied to ${j.company} recently (${recent.title}); one application per company every ${caps.company_cooldown_days ?? 14} days.` };
  return { ok: true, remaining: remainingFor(j.portal as ExternalPortal, limits) };
}

async function ensureJob(j: ExternalJob): Promise<string> {
  const stored = await findJob(j);
  if (stored) return stored.id;
  const country = guessCountry(j.location);
  const row = {
    source: "extension", external_id: `${j.portal}:${j.jobKey || dedupeKey(j.company, j.title, country)}`, dedupe_key: dedupeKey(j.company, j.title, country),
    title: j.title, company: j.company, country: country ?? null, location: j.location ?? null, url: j.url, description: "", apply_type: detectApplyType(j.url),
    portal: detectPortal({ url: j.url, integration: j.portal }), seen_on: [] as string[], status: "prepared",
  };
  const { portal, seen_on, ...legacy } = row;
  void [portal, seen_on];
  const ins = await withLegacyFallback(
    () => db().from("jobs").insert(row).select("id"),
    () => db().from("jobs").insert(legacy).select("id"),
  );
  return must<{ id: string }[]>(ins, "store job")[0].id;
}

export type ExternalOutcome = { outcome: "submitted"; confirmation?: string | null; finalUrl?: string | null } | { outcome: "needs_input"; note: string };

/**
 * The extension finished a job that came from a filtered list: store the job (once) and its application, as sent with the portal's own confirmation, or as waiting for you
 * with the reason. Either way it is in Applications, with the same history as any other.
 */
export async function recordExternal(j: ExternalJob, o: ExternalOutcome): Promise<ExternalResult> {
  const jobId = await ensureJob(j);
  let app = await applicationOf(jobId);
  if (app?.status === "submitted") return { ok: true };
  if (!app) {
    const created = must<{ id: string }[]>(await db().from("applications").insert({ job_id: jobId, status: o.outcome === "submitted" ? "assisted_pending" : "needs_input", error: o.outcome === "needs_input" ? `Browser extension: ${o.note}`.slice(0, 500) : null }).select("id"), "store application");
    app = { id: created[0].id, status: "assisted_pending" };
    await logEvent(app.id, "created", { via: "extension", portal: j.portal });
  }
  if (o.outcome === "submitted") return markSubmitted(app.id, "extension", { confirmation: o.confirmation ?? `Sent from your own ${j.portal === "linkedin" ? "LinkedIn" : "Naukri"} account by the browser extension.`, finalUrl: o.finalUrl ?? j.url });
  const message = `Browser extension: ${o.note}`.slice(0, 500);
  must(await db().from("applications").update({ status: "needs_input", error: message }).eq("id", app.id).neq("status", "submitted").select("id"), "hand back application");
  await logEvent(app.id, "needs_input", { message, via: "extension" });
  await logActivity({ kind: "application.needs_input", level: "warn", message, status: "needs_input", application_id: app.id, ...jobLogFields({ id: jobId, company: j.company, portal: j.portal }), detail: { via: "extension", title: j.title } });
  return { ok: true };
}
