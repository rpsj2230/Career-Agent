import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { jobLogFields, type JobRef } from "@/lib/activity-helpers";
import type { LogEntry } from "@/lib/activity-types";
import { db, must } from "@/lib/db";
import { decideApply } from "@/lib/apply/caps";
import { dispatchApply } from "@/lib/apply/dispatch";
import { logEvent } from "@/lib/apply/events";
import { loadCapState } from "@/lib/apply/state";
import { getSetting } from "@/lib/settings";
import type { ApplyType } from "@/lib/jobs/normalize";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), override: z.boolean().optional() }),
  z.object({ action: z.literal("mark_submitted") }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("save") }),
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("lifecycle"), lifecycle: z.enum(["applied", "interview", "rejected", "offer", "withdrawn"]), notes: z.string().max(2000).optional() }),
]);

type AppRow = { id: string; job_id: string; status: string; resume_doc_id: string | null; cover_doc_id: string | null };

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const body = parsed.data;

  const app = must<AppRow | null>(await db().from("applications").select("id,job_id,status,resume_doc_id,cover_doc_id").eq("id", id).maybeSingle(), "load application");
  if (!app) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  const jobRow = must<(JobRef & { title: string }) | null>(await db().from("jobs").select("*").eq("id", app.job_id).maybeSingle(), "load job");
  const log = (e: Omit<LogEntry, "job_id" | "company" | "country" | "portal" | "application_id">) =>
    logActivity({ ...e, ...(jobRow ? jobLogFields(jobRow) : { job_id: app.job_id }), application_id: id, detail: { ...(e.detail ?? {}), title: jobRow?.title } });
  const setApp = async (patch: Record<string, unknown>) => must(await db().from("applications").update(patch).eq("id", id).select("id"), "update application");
  const setJob = async (patch: Record<string, unknown>) => must(await db().from("jobs").update(patch).eq("id", app.job_id).select("id"), "update job");

  switch (body.action) {
    case "approve": {
      if (!["prepared", "needs_input", "failed"].includes(app.status)) return NextResponse.json({ error: `Already ${app.status}` }, { status: 409 });
      const docs = must<{ verification: { ok: boolean; issues: unknown[] } | null }[]>(
        await db().from("documents").select("verification").in("id", [app.resume_doc_id, app.cover_doc_id].filter(Boolean) as string[]), "load documents",
      );
      const unverified = docs.filter((d) => d.verification && !d.verification.ok);
      if (unverified.length && !body.override) {
        await log({ kind: "application.blocked", level: "warn", message: "Approval blocked: the documents contain claims that are not in your profile", status: "blocked", detail: { issues: unverified.flatMap((d) => d.verification?.issues ?? []) } });
        return NextResponse.json({ error: "Verification found claims that are not in your profile. Review them or approve with override.", issues: unverified.flatMap((d) => d.verification?.issues ?? []) }, { status: 409 });
      }
      const job = must<{ apply_type: ApplyType }>(await db().from("jobs").select("apply_type").eq("id", app.job_id).single(), "load job");
      const decision = decideApply(job.apply_type, await getSetting("caps"), await loadCapState());
      if (!decision.allowed) {
        await log({ kind: "application.blocked", level: "warn", message: `Approval blocked: ${decision.reason}`, status: "blocked", detail: { reason: decision.reason } });
        return NextResponse.json({ error: decision.reason }, { status: 429 });
      }
      const automated = decision.mode === "automated";
      // Atomic claim: only one concurrent request can move the application out of its pending states.
      const claimed = must<{ id: string }[]>(
        await db().from("applications")
          .update({ status: automated ? "approved" : "assisted_pending", method: decision.mode, approved_at: new Date().toISOString(), error: null })
          .eq("id", id).in("status", ["prepared", "needs_input", "failed"]).select("id"),
        "claim application",
      );
      if (claimed.length === 0) return NextResponse.json({ error: "Already being processed" }, { status: 409 });
      await log({ kind: "application.approved", message: `Approved (${decision.mode})${body.override ? " with override of unverified claims" : ""}${decision.reason ? `: ${decision.reason}` : ""}`, status: automated ? "approved" : "assisted_pending", detail: { mode: decision.mode, override: !!body.override, note: decision.reason ?? null } });
      await logEvent(id, "approved", { mode: decision.mode, override: !!body.override, note: decision.reason ?? null });
      if (automated) {
        const err = await dispatchApply(id);
        if (err) { await logEvent(id, "dispatch_failed", { error: err }); await log({ kind: "application.failed", level: "error", message: `Could not start the apply worker: ${err}`, status: "approved", detail: { error: err } }); }
        return NextResponse.json({ ok: true, mode: "automated", warning: err });
      }
      return NextResponse.json({ ok: true, mode: "assisted", note: decision.reason ?? null });
    }
    case "mark_submitted":
      await setApp({ status: "submitted", method: "assisted", submitted_at: new Date().toISOString(), lifecycle: "applied" });
      await setJob({ status: "applied" });
      await logEvent(id, "marked_submitted");
      await log({ kind: "application.submitted", message: "Marked as submitted by you (assisted)", status: "submitted", detail: { method: "assisted" } });
      return NextResponse.json({ ok: true });
    case "skip":
      await setJob({ status: "skipped", skip_reason: "Skipped by you" });
      await logEvent(id, "skipped");
      await log({ kind: "application.skipped", message: "Skipped by you", status: "skipped" });
      return NextResponse.json({ ok: true });
    case "save":
      await setJob({ status: "saved" });
      return NextResponse.json({ ok: true });
    case "retry":
      if (app.status !== "failed") return NextResponse.json({ error: "Only failed applications can be retried" }, { status: 409 });
      await setApp({ status: "prepared", error: null });
      await logEvent(id, "retry_requested");
      await log({ kind: "application.lifecycle", message: "Returned to the queue for another attempt", status: "prepared" });
      return NextResponse.json({ ok: true });
    case "lifecycle":
      await setApp({ lifecycle: body.lifecycle, notes: body.notes ?? null });
      await logEvent(id, "lifecycle", { lifecycle: body.lifecycle });
      await log({ kind: "application.lifecycle", message: `Outcome set to ${body.lifecycle}`, status: body.lifecycle, detail: { lifecycle: body.lifecycle, notes: body.notes ?? null } });
      return NextResponse.json({ ok: true });
  }
}
