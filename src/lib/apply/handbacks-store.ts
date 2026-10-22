import "server-only";
import { db } from "@/lib/db";
import { groupHandbacks, questionsInReason, type HandbackApp } from "./handbacks";

type Row = { id: string; country: string | null; error: string | null; submission: { unanswered?: string[] } | null; job: { title: string; company: string } | { title: string; company: string }[] | null };

/** The questions blocking applications right now (needs_input, not yet answered), grouped across applications. */
export async function loadHandbacks() {
  const res = await db().from("applications").select("id,country,error,submission,job:jobs(title,company)").eq("status", "needs_input").limit(300);
  if (res.error) return [];
  const apps: HandbackApp[] = (res.data as unknown as Row[]).map((r) => {
    const j = Array.isArray(r.job) ? r.job[0] : r.job;
    return { id: r.id, title: j?.title ?? "Job", company: j?.company ?? "", country: r.country, unanswered: r.submission?.unanswered?.length ? r.submission.unanswered : questionsInReason(r.error) };
  });
  return groupHandbacks(apps);
}
