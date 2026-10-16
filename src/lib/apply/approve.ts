import "server-only";
import { logActivity } from "@/lib/activity";
import { jobLogFields, type JobRef } from "@/lib/activity-helpers";
import type { LogEntry } from "@/lib/activity-types";
import { db, must } from "@/lib/db";
import type { ApplyType } from "@/lib/jobs/normalize";
import { getSetting } from "@/lib/settings";
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
  const decision = decideApply(jobRow.apply_type, await getSetting("caps"), await loadCapState());
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
  if (automated && o.dispatch) {
    warning = await dispatchApply(id);
    if (warning) { await logEvent(id, "dispatch_failed", { error: warning }); await log({ kind: "application.failed", level: "error", message: `Could not start the apply worker: ${warning}`, status: "approved", detail: { error: warning } }); }
  }
  return { ok: true, mode: decision.mode, note: decision.reason ?? null, warning };
}
