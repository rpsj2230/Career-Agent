import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { requestPending, type AssistantRequest } from "@/lib/apply/assistant-request";
import { db, must } from "@/lib/db";

/** Ask the apply assistant on your computer to start a round now. A web page cannot start a program, so this leaves a request that the running watcher picks up. */
export async function POST() {
  const row = must<{ value: AssistantRequest } | null>(await db().from("settings").select("value").eq("key", "assistant_request").maybeSingle(), "load request");
  if (requestPending(row?.value)) return NextResponse.json({ ok: true, already: true });
  must(await db().from("settings").upsert({ key: "assistant_request", value: { at: new Date().toISOString(), handled_at: null }, updated_at: new Date().toISOString() }).select("key"), "save request");
  await logActivity({ kind: "config.changed", message: "Asked the apply assistant on your computer to run now", status: "requested" });
  return NextResponse.json({ ok: true });
}
