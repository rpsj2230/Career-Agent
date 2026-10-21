import "server-only";
import { requestAssistantRun } from "./assistant-run";
import { sendApplicationEmail } from "./application-email";
import { loadDraft } from "./email-store";
import { logActivity } from "@/lib/activity";
import { jobLogFields, type JobRef } from "@/lib/activity-helpers";
import type { LogEntry } from "@/lib/activity-types";
import { db, must } from "@/lib/db";
import type { ApplyType } from "@/lib/jobs/normalize";
import { getSetting } from "@/lib/settings";
import { pauseActive } from "@/lib/pause-rules";
import { parseAtsUrl } from "@/lib/jobs/ats";
import { recentCompanyApplication } from "./cooldown";
import { decideApply } from "./caps";
import { dispatchApply } from "./dispatch";
import { logEvent } from "./events";
import { loadCapState } from "./state";

export type ApproveResult =
  | { ok: true; mode: "automated" | "assisted"; note: string | null; warning?: string | null }
  | { ok: false; status: number; error: string; issues?: unknown[] };

type AppRow = { id: string; job_id: string; status: string; resume_doc_id: string | null; cover_doc_id: string | null };

/**
 * Approve one prepared application. Shared by the Approve button and by schedules so both obey the same rules:
 * verification, daily caps, an atomic claim so nothing is submitted twice, and a full log entry.
 * `dispatch` starts the apply worker immediately (button); schedules leave it to the batch worker that follows them.
 */
export async function approveApplication(id: string, o: { override?: boolean; actor: "user" | "schedule"; runId?: string | null; dispatch?: boolean }): Promise<ApproveResult> {
  const app = must<AppRow | null>(await db().from("applications").select("id,job_id,status,resume_doc_id,cover_doc_id").eq("id", id).maybeSingle(), "load application");
  if (!app) return { ok: false, status: 404, error: "Application not found" };
  if (!["prepared", "needs_input", "failed"].includes(app.status)) return { ok: false, status: 409, error: `Already ${app.status}` };
  const jobRow = must<(JobRef & { title: string; apply_type: ApplyType }) | null>(await db().from("jobs").select("*").eq("id", app.job_id).maybeSingle(), "load job");
  const log = (e: Omit<LogEntry, "job_id" | "company" | "country" | "portal" | "application_id" | "run_id">) =>
    logActivity({ ...e, ...(jobRow ? jobLogFields(jobRow) : { job_id: app.job_id }), application_id: id, run_id: o.runId ?? null, detail: { ...(e.detail ?? {}), title: jobRow?.title, actor: o.actor } });

  const docs = must<{ verification: { ok: boolean; issues: unknown[] } | null }[]>(
    await db().from("documents").select("verification").in("id", [app.resume_doc_id, app.cover_doc_id].filter(Boolean) as string[]), "load documents",
  );
  const unverified = docs.filter((d) => d.verification && !d.verification.ok);
  if (unverified.length && !o.override) {
    const issues = unverified.flatMap((d) => d.verification?.issues ?? []);
    await log({ kind: "application.blocked", level: "warn", message: "Approval blocked: the documents contain claims that are not in your profile", status: "blocked", detail: { issues } });
    return { ok: false, status: 409, error: "Verification found claims that are not in your profile. Review them or approve with override.", issues };
  }
  if (!jobRow) return { ok: false, status: 404, error: "Job not found" };
  const capsNow = await getSetting("caps");
  if (o.actor === "schedule" && pauseActive(await getSetting("automation_pause"))) return { ok: false, status: 409, error: "Everything is paused (Settings). The application stays prepared for you." };
  if (o.actor === "schedule") {
    // the master switch: with Auto-Apply off nothing is approved by a schedule; the application stays prepared for you
    if (!(await getSetting("autoapply")).enabled) {
      const reason = "Auto-Apply is switched off (Settings > Auto-Apply). The application stays prepared for you to approve.";
      await log({ kind: "application.blocked", level: "info", message: `Left for you: ${reason}`, status: "blocked", detail: { reason, code: "autoapply_off" } });
      return { ok: false, status: 409, error: reason };
    }
    // an automatic approval does not send a second application to a company you just applied to; you can still do that by hand
    const recent = await recentCompanyApplication(jobRow.company ?? "", capsNow.company_cooldown_days ?? 14, id);
    if (recent) {
      const reason = `You applied to ${jobRow.company} recently (${recent.title}); automatic approval waits ${capsNow.company_cooldown_days ?? 14} days between applications to one company. Approve it yourself if you want both.`;
      await log({ kind: "application.blocked", level: "info", message: `Left for you: ${reason}`, status: "blocked", detail: { reason, recent } });
      return { ok: false, status: 409, error: reason };
    }
  }
  const decision = decideApply(jobRow.apply_type, capsNow, await loadCapState(), parseAtsUrl((jobRow as { url?: string }).url ?? "")?.ats ?? null);
  if (!decision.allowed) {
    await log({ kind: "application.blocked", level: "warn", message: `Approval blocked: ${decision.reason}`, status: "blocked", detail: { reason: decision.reason } });
    return { ok: false, status: 429, error: decision.reason ?? "Daily limit reached" };
  }
  const automated = decision.mode === "automated";
  // Atomic claim: only one concurrent request can move the application out of its pending states.
  const claimed = must<{ id: string }[]>(
    await db().from("applications")
      .update({ status: automated ? "approved" : "assisted_pending", method: decision.mode, approved_at: new Date().toISOString(), error: null })
      .eq("id", id).in("status", ["prepared", "needs_input", "failed"]).select("id"),
    "claim application",
  );
  if (claimed.length === 0) return { ok: false, status: 409, error: "Already being processed" };
  const by = o.actor === "schedule" ? "automatically by a schedule" : "by you";
  await log({ kind: "application.approved", message: `Approved ${by} (${decision.mode})${o.override ? " with override of unverified claims" : ""}${decision.reason ? `: ${decision.reason}` : ""}`, status: automated ? "approved" : "assisted_pending", detail: { mode: decision.mode, override: !!o.override, note: decision.reason ?? null } });
  await logEvent(id, "approved", { mode: decision.mode, override: !!o.override, note: decision.reason ?? null, actor: o.actor });
  let warning: string | null = null;
  // queued for the assistant on your computer: wake it now so a running assistant does not wait for its next round
  // an application that is also (or only) sent by email: send it now, with the resume and cover letter attached
  const draft = await loadDraft(id).catch(() => null);
  let emailNote: string | null = null;
  if (draft && draft.auto && !draft.sent) {
    const sent = await sendApplicationEmail(id, { actor: o.actor, override: o.override }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (sent.ok) emailNote = `Emailed to ${sent.to}`;
    else {
      emailNote = `The email could not be sent: ${sent.error}`;
      // when the email is the whole application, a failure hands it back to you instead of leaving it queued for the assistant
      if (draft.mode === "only") await db().from("applications").update({ status: "needs_input", error: `Needs you: the application email could not be sent. ${sent.error}` }).eq("id", id);
    }
  }
  if (!automated && draft?.mode !== "only") await requestAssistantRun("An application was queued for the assistant on your computer: asked it to run").catch(() => undefined);
  if (automated && o.dispatch) {
    warning = await dispatchApply(id);
    if (warning) { await logEvent(id, "dispatch_failed", { error: warning }); await log({ kind: "application.failed", level: "error", message: `Could not start the apply worker: ${warning}`, status: "approved", detail: { error: warning } }); }
  }
  return { ok: true, mode: decision.mode, note: [decision.reason, emailNote].filter(Boolean).join(". ") || null, warning };
}
