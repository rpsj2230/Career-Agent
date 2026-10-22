import "server-only";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { pickRetries, type FailedRow } from "./auto-retry";

/**
 * Put retryable failed applications back to "prepared" (the same resume, waiting for approval), which Autopilot then approves again
 * in the same round. Every retry is recorded on the application, so the count of tries is real and the history shows why.
 */
export async function requeueFailed(limit = 100): Promise<number> {
  const failed = await db().from("applications").select("id, job_id, error").eq("status", "failed").order("created_at", { ascending: true }).limit(500);
  if (failed.error) throw new Error(`load failed applications: ${failed.error.message}`);
  const rows = (failed.data ?? []) as FailedRow[];
  if (rows.length === 0) return 0;
  const ev = await db().from("apply_events").select("application_id").eq("kind", "auto_retry").in("application_id", rows.map((r) => r.id));
  const attempts = new Map<string, number>();
  for (const e of (ev.data ?? []) as { application_id: string }[]) attempts.set(e.application_id, (attempts.get(e.application_id) ?? 0) + 1);
  let n = 0;
  for (const r of pickRetries(rows, attempts, { limit })) {
    const upd = await db().from("applications").update({ status: "prepared", error: null, approved_at: null }).eq("id", r.id).eq("status", "failed").select("id");
    if (upd.error || !upd.data?.length) continue;
    await db().from("jobs").update({ status: "prepared" }).eq("id", r.job_id);
    await db().from("apply_events").insert({ application_id: r.id, kind: "auto_retry", detail: { attempt: (attempts.get(r.id) ?? 0) + 1, previous_error: r.error } });
    await logActivity({ kind: "application.lifecycle", level: "info", message: `Trying again automatically (attempt ${(attempts.get(r.id) ?? 0) + 1}): ${r.error ?? "the last attempt failed"}`, status: "prepared", application_id: r.id, job_id: r.job_id, detail: { auto_retry: true } });
    n++;
  }
  return n;
}
