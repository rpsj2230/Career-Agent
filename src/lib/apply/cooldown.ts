import "server-only";
import { db } from "@/lib/db";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(pvt|private|ltd|limited|inc|llc|llp|corp|co|pte)\b/g, "").replace(/\s+/g, " ").trim();

/** An application to the same company inside the cool-down, if there is one (another role there, approved or sent recently). */
export async function recentCompanyApplication(company: string, days: number, excludeAppId: string, now = new Date()): Promise<{ title: string; at: string } | null> {
  if (days <= 0 || !norm(company)) return null;
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const res = await db().from("applications").select("id,approved_at,status,job:jobs(title,company)").in("status", ["approved", "submitting", "submitted", "assisted_pending"]).gte("approved_at", cutoff).limit(500);
  if (res.error) return null;
  for (const a of res.data as unknown as { id: string; approved_at: string; job: { title: string; company: string } | { title: string; company: string }[] | null }[]) {
    const j = Array.isArray(a.job) ? a.job[0] : a.job;
    if (a.id !== excludeAppId && j && norm(j.company) === norm(company)) return { title: j.title, at: a.approved_at };
  }
  return null;
}
