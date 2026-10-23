import "server-only";
import { logActivity } from "@/lib/activity";
import { logConfig } from "@/lib/activity-helpers";
import { requeueStatus, scopedQuestion, withAnswer } from "@/lib/apply/handbacks";
import { logEvent } from "@/lib/apply/events";
import { COUNTRY_NAME_MAP } from "@/lib/countries";
import { db, must } from "@/lib/db";

const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

/**
 * Save an answer to a question the assistant could not answer: it goes into the answer bank and into every application that was waiting for it,
 * and those applications go back to the queue (the assistant's, when it was the assistant that handed them back). Used by the answer box and by the AI fallback on the runner.
 */
export async function saveAnswerAndRequeue(o: { question: string; answer: string; country?: string | null; appIds: string[]; by: "you" | "ai" }): Promise<{ requeued: number }> {
  const question = scopedQuestion(o.question, o.country ? COUNTRY_NAME_MAP[o.country] ?? null : null);
  must(await db().from("answer_bank").upsert({ key: slug(question), question, answer: o.answer, updated_at: new Date().toISOString() }, { onConflict: "key" }).select("key"), "save answer");
  await logConfig(o.by === "ai" ? "Answer written by the AI from your profile for a handed-back application" : "Answer saved from a handed-back application", { question });

  let requeued = 0;
  if (o.appIds.length) {
    const rows = must<{ id: string; job_id: string; status: string; approved_at: string | null; answers: { question: string; answer: string; source: string }[] | null }[]>(
      await db().from("applications").select("id,job_id,status,approved_at,answers").in("id", o.appIds), "load applications");
    // the newest hand-back of each application says who handed it back
    const hb = must<{ application_id: string; detail: { assistant?: boolean } | null }[]>(
      await db().from("activity_log").select("application_id,detail").eq("kind", "application.needs_input").in("application_id", o.appIds).order("at", { ascending: false }).limit(1000), "load hand-backs");
    const last = new Map<string, { assistant?: boolean } | null>();
    for (const e of hb) if (!last.has(e.application_id)) last.set(e.application_id, e.detail);
    for (const a of rows.filter((r) => r.status === "needs_input")) {
      const status = requeueStatus(a, last.get(a.id) ?? null);
      const upd = await db().from("applications").update({ answers: withAnswer(a.answers ?? [], question, o.answer), status, error: null }).eq("id", a.id).eq("status", "needs_input").select("id");
      if (upd.error || !upd.data?.length) continue;
      requeued++;
      await logEvent(a.id, "answer_added", { question, to: status, by: o.by });
      await logActivity({ kind: "application.lifecycle", message: `Answer ${o.by === "ai" ? "written by the AI" : "saved"} for "${question}": ${status === "assisted_pending" ? "back in the assistant's queue" : "returned to the queue"}`, status, application_id: a.id, job_id: a.job_id, detail: { question, by: o.by } });
    }
  }
  return { requeued };
}
