import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { jobLogFields, type JobRef } from "@/lib/activity-helpers";
import type { LogEntry } from "@/lib/activity-types";
import { assistedRecord } from "@/lib/apply/submission";
import { db, must } from "@/lib/db";
import { withLegacyFallback } from "@/lib/schema";
import { approveApplication } from "@/lib/apply/approve";
import { logEvent } from "@/lib/apply/events";
import { skipApplication } from "@/lib/apply/skip";

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
      const now = new Date();
      const patch = { status: "submitted", method: "assisted", submitted_at: now.toISOString(), lifecycle: "applied" };
      must(
        await withLegacyFallback(
          () => db().from("applications").update({ ...patch, submission: assistedRecord(jobRow?.url ?? "", now) }).eq("id", id).select("id"),
          () => db().from("applications").update(patch).eq("id", id).select("id"),
        ),
        "mark submitted",
      );
      await setJob({ status: "applied" });
      await logEvent(id, "marked_submitted");
      await log({ kind: "application.submitted", message: "Marked as submitted by you (assisted)", status: "submitted", detail: { method: "assisted" } });
      return NextResponse.json({ ok: true });
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
    case "lifecycle":
      await setApp({ lifecycle: body.lifecycle, notes: body.notes ?? null });
      await logEvent(id, "lifecycle", { lifecycle: body.lifecycle });
      await log({ kind: "application.lifecycle", message: `Outcome set to ${body.lifecycle}`, status: body.lifecycle, detail: { lifecycle: body.lifecycle, notes: body.notes ?? null } });
      return NextResponse.json({ ok: true });
  }
}
