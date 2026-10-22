import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { logConfig } from "@/lib/activity-helpers";
import { requeueStatus, scopedQuestion, withAnswer } from "@/lib/apply/handbacks";
import { logEvent } from "@/lib/apply/events";
import { COUNTRY_NAME_MAP } from "@/lib/countries";
import { db, must } from "@/lib/db";

const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const Body = z.object({
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(1).max(2000),
  /** answer only for forms in this country */
  country: z.string().regex(/^[a-z]{2}$/).nullable().optional(),
  /** applications that were handed back for this question: they go back to your queue with the answer filled in */
  appIds: z.array(z.string().uuid()).max(100).default([]),
});

/** Answer a question once: it goes into your answer bank and into every application that was waiting for it. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid answer" }, { status: 400 });
  const { answer, appIds } = parsed.data;
  const question = scopedQuestion(parsed.data.question, parsed.data.country ? COUNTRY_NAME_MAP[parsed.data.country] ?? null : null);
  must(await db().from("answer_bank").upsert({ key: slug(question), question, answer, updated_at: new Date().toISOString() }, { onConflict: "key" }).select("key"), "save answer");
  await logConfig("Answer saved from a handed-back application", { question });

  let requeued = 0;
  if (appIds.length) {
    const rows = must<{ id: string; job_id: string; status: string; approved_at: string | null; answers: { question: string; answer: string; source: string }[] | null }[]>(
      await db().from("applications").select("id,job_id,status,approved_at,answers").in("id", appIds), "load applications");
    // the newest hand-back of each application says who handed it back
    const hb = must<{ application_id: string; detail: { assistant?: boolean } | null }[]>(
      await db().from("activity_log").select("application_id,detail").eq("kind", "application.needs_input").in("application_id", appIds).order("at", { ascending: false }).limit(1000), "load hand-backs");
    const last = new Map<string, { assistant?: boolean } | null>();
    for (const e of hb) if (!last.has(e.application_id)) last.set(e.application_id, e.detail);
    for (const a of rows.filter((r) => r.status === "needs_input")) {
      const status = requeueStatus(a, last.get(a.id) ?? null);
      const upd = await db().from("applications").update({ answers: withAnswer(a.answers ?? [], question, answer), status, error: null }).eq("id", a.id).eq("status", "needs_input").select("id");
      if (upd.error || !upd.data?.length) continue;
      requeued++;
      await logEvent(a.id, "answer_added", { question, to: status });
      await logActivity({ kind: "application.lifecycle", message: `Answer saved for "${question}": ${status === "assisted_pending" ? "back in the assistant's queue" : "returned to the queue"}`, status, application_id: a.id, job_id: a.job_id, detail: { question } });
    }
  }
  return NextResponse.json({ ok: true, requeued });
}
