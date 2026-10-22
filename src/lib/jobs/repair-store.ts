import "server-only";
import { db } from "@/lib/db";
import { appliedOnDate, repairJobText } from "./repair";

/** Fix jobs saved earlier with HTML or entities in their company or place. Cheap and safe to run every hour; returns how many were changed. */
export async function repairGarbledJobs(limit = 300): Promise<number> {
  const found = await db().from("jobs").select("id, company, location").or("location.like.%<%,company.like.%<%,company.like.%&%,location.like.%&%").limit(limit);
  if (found.error) throw new Error(`load garbled jobs: ${found.error.message}`);
  let n = 0;
  for (const j of (found.data ?? []) as { id: string; company: string; location: string | null }[]) {
    const fixed = repairJobText(j);
    if (!fixed) continue;
    const upd = await db().from("jobs").update({ company: fixed.company, location: fixed.location }).eq("id", j.id);
    if (!upd.error) n++;
  }
  return n;
}

/**
 * Jobs saved from a portal's "your application was sent" receipt are already applied for: settle them as applied instead of leaving them
 * as something that "needs you". Returns how many applications were settled.
 */
export async function settleReceiptJobs(limit = 200): Promise<number> {
  const found = await db().from("jobs").select("id, location").like("location", "Applied%").limit(limit);
  if (found.error) throw new Error(`load receipt jobs: ${found.error.message}`);
  let n = 0;
  for (const j of (found.data ?? []) as { id: string; location: string | null }[]) {
    const day = appliedOnDate(j.location);
    if (!day) continue;
    await db().from("jobs").update({ status: "applied", location: null }).eq("id", j.id);
    const apps = await db().from("applications").select("id").eq("job_id", j.id).in("status", ["prepared", "approved", "assisted_pending", "needs_input", "failed"]);
    for (const a of (apps.data ?? []) as { id: string }[]) {
      const upd = await db().from("applications").update({ status: "submitted", method: "assisted", lifecycle: "applied", submitted_at: `${day}T12:00:00Z`, error: null }).eq("id", a.id);
      if (!upd.error) {
        n++;
        await db().from("apply_events").insert({ application_id: a.id, kind: "marked_submitted", detail: { why: `The portal's own receipt email says you applied on ${day}` } });
      }
    }
  }
  return n;
}
