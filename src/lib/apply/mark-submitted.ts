import { logActivity } from "@/lib/activity";
import { jobLogFields, type JobRef } from "@/lib/activity-helpers";
import { assistedRecord } from "@/lib/apply/submission";
import { logEvent } from "@/lib/apply/events";
import { db, must } from "@/lib/db";
import { withLegacyFallback } from "@/lib/schema";

/** "I submitted it": the application is recorded as sent by you (assisted), its job as applied, and the event is logged. Shared by the application page and the browser extension. */
export async function markSubmitted(id: string, via: "app" | "extension" = "app", extra: { confirmation?: string | null; finalUrl?: string | null } = {}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const app = must<{ id: string; job_id: string; status: string } | null>(await db().from("applications").select("id,job_id,status").eq("id", id).maybeSingle(), "load application");
  if (!app) return { ok: false, status: 404, error: "Application not found" };
  if (app.status === "submitted") return { ok: true };
  const jobRow = must<(JobRef & { title: string; url?: string }) | null>(await db().from("jobs").select("*").eq("id", app.job_id).maybeSingle(), "load job");
  const now = new Date();
  const patch = { status: "submitted", method: "assisted", submitted_at: now.toISOString(), lifecycle: "applied" };
  // the extension sent it itself and read the employer's confirmation: that text is the record, not just "you said so"
  const record = extra.confirmation
    ? { ...assistedRecord(jobRow?.url ?? "", now), outcome: "submitted" as const, final_url: extra.finalUrl ?? null, confirmation: { text: extra.confirmation.slice(0, 600), screenshot: null }, note: "Sent by the browser extension in your own browser. The employer's confirmation text is recorded; the values it entered are not." }
    : assistedRecord(jobRow?.url ?? "", now);
  must(
    await withLegacyFallback(
      () => db().from("applications").update({ ...patch, submission: record }).eq("id", id).select("id"),
      () => db().from("applications").update(patch).eq("id", id).select("id"),
    ),
    "mark submitted",
  );
  must(await db().from("jobs").update({ status: "applied" }).eq("id", app.job_id).select("id"), "update job");
  await logEvent(id, "marked_submitted");
  await logActivity({
    kind: "application.submitted", message: via === "extension" ? (extra.confirmation ? "Sent by the browser extension; the employer's confirmation was read" : "Marked as submitted by you (assisted, from the browser extension)") : "Marked as submitted by you (assisted)", status: "submitted",
    ...(jobRow ? jobLogFields(jobRow) : { job_id: app.job_id }), application_id: id, detail: { method: "assisted", via, title: jobRow?.title },
  });
  return { ok: true };
}
