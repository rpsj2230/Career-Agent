import "server-only";
import { db } from "@/lib/db";
import { repairJobText } from "./repair";

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
