import "server-only";
import { logActivity } from "@/lib/activity";
import { jobLogFields, type JobRef } from "@/lib/activity-helpers";
import { db, must } from "@/lib/db";
import { logEvent } from "./events";

/** Skip a prepared application (the Skip button and Telegram share this). Returns false when it no longer exists. */
export async function skipApplication(id: string): Promise<boolean> {
  const app = must<{ id: string; job_id: string } | null>(await db().from("applications").select("id,job_id").eq("id", id).maybeSingle(), "load application");
  if (!app) return false;
  const job = must<(JobRef & { title: string }) | null>(await db().from("jobs").select("*").eq("id", app.job_id).maybeSingle(), "load job");
  must(await db().from("jobs").update({ status: "skipped", skip_reason: "Skipped by you" }).eq("id", app.job_id).select("id"), "update job");
  await logEvent(id, "skipped");
  await logActivity({ kind: "application.skipped", message: "Skipped by you", status: "skipped", ...(job ? jobLogFields(job) : { job_id: app.job_id }), application_id: id, detail: { title: job?.title } });
  return true;
}
