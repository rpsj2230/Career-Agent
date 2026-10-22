import "server-only";
import { db } from "@/lib/db";
import { fetchAll } from "@/lib/fetch-all";
import { groupHandbacks } from "@/lib/handback-reasons";
import { portalLabel } from "@/lib/jobs/portal";

/** Applications handed back to you, grouped by why. */
export async function handbackReasons() {
  const res = await fetchAll<{ error: string | null; portal: string | null }>((a, b) => db().from("applications").select("error,portal").eq("status", "needs_input").order("created_at", { ascending: false }).range(a, b), 5000);
  if (res.error) return null;
  return { total: res.data.length, lines: groupHandbacks(res.data, portalLabel) };
}
