import "server-only";
import { logActivity } from "@/lib/activity";
import { jobLogFields, type JobRef } from "@/lib/activity-helpers";
import { recentCompanyApplication } from "@/lib/apply/cooldown";
import { logEvent } from "@/lib/apply/events";
import { db, must } from "@/lib/db";
import { pauseActive } from "@/lib/pause-rules";
import { getSetting } from "@/lib/settings";
import { CLAIMABLE_STATUSES, decideAuto, type AutoState } from "./auto";

const midnightUtc = (now: Date) => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

export async function autoSubmitState(now = new Date()): Promise<AutoState> {
  const [auto, caps, pause] = await Promise.all([getSetting("autoapply"), getSetting("caps"), getSetting("automation_pause")]);
  const today = await db().from("applications").select("id", { count: "exact", head: true }).eq("status", "submitted").gte("submitted_at", midnightUtc(now));
  return decideAuto({ enabled: auto.enabled, paused: pauseActive(pause, now), dailyTotal: caps.daily_total, submittedToday: today.count ?? 0 });
}

export type ClaimResult = { ok: true } | { ok: false; status: number; error: string; global?: boolean };

/**
 * The extension takes an application to send it by itself. The same rules as an automatic approval apply (switch, pause, daily limit, one application per
 * company inside the cool-down), enforced here and not trusted to the extension. The application is "submitting" while the extension has it, so the assistant leaves it
 * alone, and the stuck-application check frees it if the browser is closed half way.
 */
export async function claimApplication(id: string, now = new Date()): Promise<ClaimResult> {
  const state = await autoSubmitState(now);
  if (!state.allowed) return { ok: false, status: 409, error: state.why ?? "Not allowed now", global: true };
  const app = must<{ id: string; job_id: string; status: string } | null>(await db().from("applications").select("id,job_id,status").eq("id", id).maybeSingle(), "load application");
  if (!app) return { ok: false, status: 404, error: "Application not found" };
  const job = must<(JobRef & { title: string }) | null>(await db().from("jobs").select("*").eq("id", app.job_id).maybeSingle(), "load job");
  const caps = await getSetting("caps");
  const recent = await recentCompanyApplication(job?.company ?? "", caps.company_cooldown_days ?? 14, id, now);
  if (recent) return { ok: false, status: 409, error: `You applied to ${job?.company} recently (${recent.title}); one application per company every ${caps.company_cooldown_days ?? 14} days. Send this one yourself if you want both.` };
  const upd = must<{ id: string }[]>(await db().from("applications").update({ status: "submitting", error: null }).eq("id", id).in("status", [...CLAIMABLE_STATUSES]).select("id"), "claim application");
  if (!upd.length) return { ok: false, status: 409, error: `Already ${app.status}` };
  await logEvent(id, "worker_started", { via: "extension" });
  await logActivity({ kind: "application.approved", message: "The browser extension took this application to send it", status: "submitting", ...(job ? jobLogFields(job) : { job_id: app.job_id }), application_id: id, detail: { via: "extension", title: job?.title } });
  return { ok: true };
}

/** The extension could not finish (a question only you can answer, a captcha, a page it does not trust): the application goes back to you with the reason. */
export async function releaseApplication(id: string, note: string): Promise<ClaimResult> {
  const message = `Browser extension: ${note}`.slice(0, 500);
  const upd = must<{ id: string; job_id: string }[]>(await db().from("applications").update({ status: "needs_input", error: message }).eq("id", id).eq("status", "submitting").select("id,job_id"), "release application");
  if (!upd.length) return { ok: false, status: 409, error: "It was not being handled by the extension" };
  await logEvent(id, "needs_input", { message, via: "extension" });
  await logActivity({ kind: "application.needs_input", level: "warn", message, status: "needs_input", application_id: id, job_id: upd[0].job_id, detail: { via: "extension" } });
  return { ok: true };
}
