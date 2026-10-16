import "server-only";
import { db, must } from "@/lib/db";

export async function logEvent(applicationId: string, kind: string, detail: Record<string, unknown> = {}) {
  must(await db().from("apply_events").insert({ application_id: applicationId, kind, detail }).select("id"), `log ${kind}`);
}
