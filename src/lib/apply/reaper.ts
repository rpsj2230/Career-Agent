import "server-only";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";

/**
 * An application is "submitting" while a worker has it. If that worker is killed (a cancelled run, a crashed runner) the
 * application would stay there forever and nothing would ever pick it up or tell you. After `maxMinutes` without a result
 * it is handed back as needing you, with the reason, so no application is silently lost. We do not know whether the
 * employer received it, so the message says to check before retrying.
 */
export async function reapStuckApplications(maxMinutes = 75, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - maxMinutes * 60_000).toISOString();
  const stuck = await db().from("applications").select("id, job_id, approved_at").eq("status", "submitting").limit(100);
  if (stuck.error) throw new Error(`load stuck applications: ${stuck.error.message}`);
  let n = 0;
  for (const a of (stuck.data ?? []) as { id: string; job_id: string; approved_at: string | null }[]) {
    const ev = await db().from("apply_events").select("at").eq("application_id", a.id).eq("kind", "worker_started").order("at", { ascending: false }).limit(1);
    const startedAt = (ev.data as { at: string }[] | null)?.[0]?.at ?? a.approved_at;
    if (!startedAt || startedAt >= cutoff) continue;
    const message = `The worker stopped before finishing (no result for ${maxMinutes} minutes). Check the employer's site or your email to see whether it was sent before trying again.`;
    const upd = await db().from("applications").update({ status: "needs_input", error: message }).eq("id", a.id).eq("status", "submitting").select("id");
    if (upd.error || !upd.data?.length) continue;
    await db().from("apply_events").insert({ application_id: a.id, kind: "needs_input", detail: { message, reaped: true } });
    await logActivity({ kind: "application.needs_input", level: "warn", message, status: "needs_input", application_id: a.id, job_id: a.job_id, detail: { reaped: true } });
    n++;
  }
  return n;
}
