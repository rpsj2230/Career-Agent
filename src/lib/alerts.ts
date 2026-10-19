import "server-only";
import { db, must } from "@/lib/db";
import { notifyProfile } from "@/lib/notify-profile";

const KEY = "alerts_sent";

/** Send a Telegram message at most once per `hours` for the same `key`, so a recurring problem does not repeat all day. Never throws. */
export async function alertOnce(key: string, hours: number, message: string, now = new Date()): Promise<boolean> {
  try {
    const row = must<{ value: Record<string, string> } | null>(await db().from("settings").select("value").eq("key", KEY).maybeSingle(), "load alerts");
    const sent = row?.value ?? {};
    if (sent[key] && now.getTime() - new Date(sent[key]).getTime() < hours * 3_600_000) return false;
    const next = Object.fromEntries(Object.entries({ ...sent, [key]: now.toISOString() }).filter(([, at]) => now.getTime() - new Date(at).getTime() < 14 * 86_400_000));
    must(await db().from("settings").upsert({ key: KEY, value: next, updated_at: now.toISOString() }).select("key"), "save alerts");
    await notifyProfile(message);
    return true;
  } catch (e) {
    console.error(`[alerts] could not send "${key}": ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
