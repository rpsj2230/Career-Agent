import "server-only";
import { db } from "@/lib/db";

/** How much is waiting: jobs found but not scored, and matches that have no resume prepared yet. */
export async function backlogCounts(): Promise<{ unscored: number; unprepared: number }> {
  const count = async (status: string) => (await db().from("jobs").select("id", { count: "exact", head: true }).eq("status", status)).count ?? 0;
  const [unscored, unprepared] = await Promise.all([count("new"), count("queued")]);
  return { unscored, unprepared };
}
