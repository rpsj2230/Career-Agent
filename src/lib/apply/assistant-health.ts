import "server-only";
import { DateTime } from "luxon";
import { alertOnce } from "@/lib/alerts";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { assistantVerdict, type Heartbeat } from "./assistant-verdict";

export async function loadHeartbeat(): Promise<Heartbeat | null> {
  const r = await db().from("settings").select("value").eq("key", "assistant_heartbeat").maybeSingle();
  return (r.data as { value: Heartbeat } | null)?.value ?? null;
}

async function waiting(): Promise<{ count: number; oldest: string | null }> {
  const r = await db().from("applications").select("approved_at").eq("status", "assisted_pending").order("approved_at", { ascending: true }).limit(500);
  if (r.error) return { count: 0, oldest: null };
  const rows = r.data as { approved_at: string | null }[];
  return { count: rows.length, oldest: rows[0]?.approved_at ?? null };
}

/** For the dashboard: is the assistant on your computer reporting in, and how many applications wait for it. Null when nothing is relevant. */
export async function assistantStatus(now = new Date()) {
  const [hb, w, caps] = await Promise.all([loadHeartbeat(), waiting(), getSetting("caps")]);
  const v = assistantVerdict({ handsFree: !!caps.local_auto_enabled, waiting: w.count, oldestWaiting: w.oldest, heartbeat: hb, now, localHour: hb?.tz ? DateTime.fromJSDate(now, { zone: hb.tz }).hour : null });
  return v.relevant ? v : null;
}

/** Tell you (at most twice a day) when applications are waiting for the assistant on your computer and it has not been seen for hours. Never throws. */
export async function checkAssistant(now = new Date()): Promise<boolean> {
  try {
    const v = await assistantStatus(now);
    if (!v?.offline) return false;
    return await alertOnce("assistant-offline", 12, `Career Agent: ${v.text}`);
  } catch (e) {
    console.error(`[assistant] health check failed: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
