import "server-only";
import { logActivity } from "@/lib/activity";
import { db, must } from "@/lib/db";
import { requestPending, type AssistantRequest } from "./assistant-request";

/**
 * Leave a "run now" request for the assistant on your computer. A web page cannot start a program there, so the running watcher
 * picks the request up within about 30 seconds (and handles it whatever the working hours). Used by the button AND automatically
 * whenever an application is queued for the assistant, so a running assistant never waits for its next scheduled round.
 */
export async function requestAssistantRun(why: string): Promise<{ already: boolean }> {
  const row = must<{ value: AssistantRequest } | null>(await db().from("settings").select("value").eq("key", "assistant_request").maybeSingle(), "load request");
  if (requestPending(row?.value)) return { already: true };
  must(await db().from("settings").upsert({ key: "assistant_request", value: { at: new Date().toISOString(), handled_at: null }, updated_at: new Date().toISOString() }).select("key"), "save request");
  await logActivity({ kind: "config.changed", message: why, status: "requested" }).catch(() => undefined);
  return { already: false };
}
