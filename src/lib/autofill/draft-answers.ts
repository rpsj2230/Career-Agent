import { db, must } from "@/lib/db";
import { logConfig } from "@/lib/activity-helpers";
import { runText } from "@/lib/llm/registry";
import { getProfile } from "@/lib/profile/store";
import { putSetting } from "@/lib/settings";
import { WRITTEN_QUESTIONS } from "@/lib/standard-questions";
import { cleanProse, judgeWritten, richFacts, writtenTextPrompt, WRITTEN_TEXT_SYSTEM, type Dropped } from "./written-answers";

export const answerKey = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export type DraftResult = { written: number; dropped: Dropped[]; note: string; errors: string[] };

/** What the Profile page shows after a run, so "did it run, and what happened" never needs a log. */
export type LastDraft = { at: string; where: "github" | "website"; written: number; dropped: Dropped[]; errors: string[] };

/**
 * Drafts the standard interview questions that have no answer yet, from the profile only, and saves them in the answer bank (an answer you already wrote is never touched;
 * an answer that states a figure the profile does not contain is not saved). One question per request and the answer asked for as plain text, so a small or free model has
 * nothing to get wrong but the writing. Shared by the website button (a few at a time, short) and the background task on the runner (one at a time, long, so the local model can finish).
 */
export async function draftInterviewAnswers(o: { budgetMs: number; sequential: boolean; where?: "github" | "website" }): Promise<DraftResult | { error: string }> {
  const profile = await getProfile();
  if (profile.experience.length === 0) return { error: "Import and confirm your profile first" };
  const have = must<{ key: string; answer: string }[]>(await db().from("answer_bank").select("key,answer"), "load answer bank");
  const answered = new Set(have.filter((h) => h.answer.trim()).map((h) => h.key));
  const todo = WRITTEN_QUESTIONS.filter((q) => !answered.has(answerKey(q)));
  if (todo.length === 0) return { written: 0, dropped: [], errors: [], note: "Every interview question already has your answer" };

  const facts = richFacts(profile);
  const deadline = Date.now() + o.budgetMs;
  const perQuestionMs = o.sequential ? 240_000 : 40_000;
  const kept: string[] = [];
  const dropped: Dropped[] = [];
  const errors = new Set<string>();

  const one = async (question: string) => {
    if (Date.now() > deadline - 5_000) { dropped.push({ question, why: "not reached before the time limit; press the button again for the rest" }); return; }
    try {
      const { text } = await runText({ task: "tailor", system: WRITTEN_TEXT_SYSTEM, prompt: writtenTextPrompt(profile, question), prefer: "strong", budgetMs: Math.min(perQuestionMs, deadline - Date.now()), skipParked: true });
      const j = judgeWritten(cleanProse(text), facts);
      if (!j.ok) { dropped.push({ question, why: j.why }); return; }
      must(await db().from("answer_bank").upsert({ key: answerKey(question), question, answer: j.answer, updated_at: new Date().toISOString() }, { onConflict: "key" }).select("key"), "save drafted answer");
      kept.push(question);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 900);
      errors.add(msg);
      dropped.push({ question, why: "no model could write it" });
    }
  };

  if (o.sequential) for (const q of todo) await one(q);
  else { const queue = [...todo]; await Promise.all(Array.from({ length: 4 }, async () => { for (let q = queue.shift(); q; q = queue.shift()) await one(q); })); }

  if (kept.length) await logConfig("Interview answers drafted from the profile", { written: kept.length, dropped: dropped.length });
  const last: LastDraft = { at: new Date().toISOString(), where: o.where ?? (o.sequential ? "github" : "website"), written: kept.length, dropped, errors: [...errors].slice(0, 3) };
  await putSetting("write_answers_last", last).catch(() => undefined);
  const why = [...new Set(dropped.map((d) => d.why))].slice(0, 2).join("; ");
  return { written: kept.length, dropped, errors: last.errors, note: `${kept.length} answer${kept.length === 1 ? "" : "s"} written${dropped.length ? `; ${dropped.length} left for you (${why})` : ""}` };
}
