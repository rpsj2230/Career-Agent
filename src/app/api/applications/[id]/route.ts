import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { jobLogFields, type JobRef } from "@/lib/activity-helpers";
import type { LogEntry } from "@/lib/activity-types";
import { db, must } from "@/lib/db";
import { markSubmitted } from "@/lib/apply/mark-submitted";
import { approveApplication } from "@/lib/apply/approve";
import { logEvent } from "@/lib/apply/events";
import { skipApplication } from "@/lib/apply/skip";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), override: z.boolean().optional() }),
  z.object({ action: z.literal("mark_submitted") }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("save") }),
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("reapply"), confirmSubmitted: z.boolean().optional() }),
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
  const jobRow = must<(JobRef & { title: string; url?: string }) | null>(await db().from("jobs").select("*").eq("id", app.job_id).maybeSingle(), "load job");
  const log = (e: Omit<LogEntry, "job_id" | "company" | "country" | "portal" | "application_id">) =>
    logActivity({ ...e, ...(jobRow ? jobLogFields(jobRow) : { job_id: app.job_id }), application_id: id, detail: { ...(e.detail ?? {}), title: jobRow?.title } });
  const setApp = async (patch: Record<string, unknown>) => must(await db().from("applications").update(patch).eq("id", id).select("id"), "update application");
  const setJob = async (patch: Record<string, unknown>) => must(await db().from("jobs").update(patch).eq("id", app.job_id).select("id"), "update job");

  switch (body.action) {
    case "approve": {
      const r = await approveApplication(id, { override: body.override, actor: "user", dispatch: true });
      if (!r.ok) return NextResponse.json({ error: r.error, issues: r.issues }, { status: r.status });
      return NextResponse.json(r.mode === "automated" ? { ok: true, mode: "automated", warning: r.warning } : { ok: true, mode: "assisted", note: r.note });
    }
    case "mark_submitted": {
      const r = await markSubmitted(id);
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
    }
    case "skip":
      await skipApplication(id);
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
    case "reapply": {
      // apply again with the same resume and cover letter: back to "Pending approval", then press Approve
      if (["approved", "submitting"].includes(app.status)) return NextResponse.json({ error: "This application is being sent right now. Wait until it finishes." }, { status: 409 });
      if (app.status === "prepared") return NextResponse.json({ error: "It is already waiting for your approval. Press Approve." }, { status: 409 });
      if (app.status === "submitted" && !body.confirmSubmitted) return NextResponse.json({ error: "This application was already submitted. Confirm that you want to apply again.", needsConfirm: true }, { status: 409 });
      await setApp({ status: "prepared", error: null, approved_at: null, submitted_at: null, lifecycle: "none" });
      await setJob({ status: "prepared" });
      await logEvent(id, "reapply_requested", { previousStatus: app.status });
      await log({ kind: "application.lifecycle", message: `Set up to apply again with the same resume (it was ${app.status})`, status: "prepared", detail: { previousStatus: app.status } });
      return NextResponse.json({ ok: true, note: "Back to Pending approval with the same resume and cover letter. Press Approve to apply again." });
    }
    case "lifecycle":
      await setApp({ lifecycle: body.lifecycle, notes: body.notes ?? null });
      await logEvent(id, "lifecycle", { lifecycle: body.lifecycle });
      await log({ kind: "application.lifecycle", message: `Outcome set to ${body.lifecycle}`, status: body.lifecycle, detail: { lifecycle: body.lifecycle, notes: body.notes ?? null } });
      return NextResponse.json({ ok: true });
  }
}
