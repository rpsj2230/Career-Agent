import "server-only";
import { db } from "@/lib/db";
import { sendTelegramWithButtons } from "@/lib/notify";
import { callbackData, promptText } from "@/lib/telegram";

const SEEN = "telegram_prompted";

/** Send up to `max` newly prepared applications to your phone with Approve/Skip buttons (each only once). No-op until the buttons are connected. Never throws. */
export async function promptPrepared(max = 5): Promise<number> {
  try {
    const flag = await db().from("settings").select("value").eq("key", "telegram_buttons").maybeSingle();
    if (!(flag.data as { value: { enabled?: boolean } } | null)?.value?.enabled) return 0;
    const seenRow = await db().from("settings").select("value").eq("key", SEEN).maybeSingle();
    const seen = new Set<string>(((seenRow.data as { value: { ids?: string[] } } | null)?.value?.ids) ?? []);
    const apps = await db().from("applications").select("id,job_id").eq("status", "prepared").order("created_at", { ascending: false }).limit(60);
    const fresh = ((apps.data ?? []) as { id: string; job_id: string }[]).filter((a) => !seen.has(a.id));
    if (!fresh.length) return 0;
    const ids = fresh.map((a) => a.job_id);
    const [jobs, scores] = await Promise.all([
      db().from("jobs").select("id,title,company,country,url").in("id", ids),
      db().from("job_scores").select("job_id,score").in("job_id", ids),
    ]);
    const job = new Map(((jobs.data ?? []) as { id: string; title: string; company: string; country: string | null; url: string }[]).map((j) => [j.id, j]));
    const score = new Map(((scores.data ?? []) as { job_id: string; score: number }[]).map((s) => [s.job_id, s.score]));
    const ranked = fresh.filter((a) => job.has(a.job_id)).sort((a, b) => (score.get(b.job_id) ?? 0) - (score.get(a.job_id) ?? 0)).slice(0, max);
    let sent = 0;
    for (const a of ranked) {
      const j = job.get(a.job_id)!;
      const ok = await sendTelegramWithButtons(promptText({ ...j, score: score.get(a.job_id) }), [{ text: "Approve", data: callbackData("approve", a.id) }, { text: "Skip", data: callbackData("skip", a.id) }]);
      if (!ok) break;
      seen.add(a.id); sent++;
    }
    if (sent) await db().from("settings").upsert({ key: SEEN, value: { ids: [...seen].slice(-300) }, updated_at: new Date().toISOString() });
    return sent;
  } catch (e) {
    console.error(`[telegram] could not send prompts: ${e instanceof Error ? e.message : e}`);
    return 0;
  }
}
