import { db, must } from "@/lib/db";
import { logConfig } from "@/lib/activity-helpers";
import { runStructured } from "@/lib/llm/registry";
import { getProfile } from "@/lib/profile/store";
import { WRITTEN_QUESTIONS } from "@/lib/standard-questions";
import { WrittenAnswers, richFacts, usableWritten, writtenPrompt, WRITTEN_SYSTEM, type Dropped } from "./written-answers";

export const answerKey = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export type DraftResult = { written: number; dropped: Dropped[]; note: string };

/**
 * Drafts the standard interview questions that have no answer yet, from the profile only, and saves them in the answer bank (an answer you
 * already wrote is never touched; an answer that states a figure the profile does not contain is not saved). Shared by the website button
 * (short, groups side by side) and the background task on the runner (long budget, one group at a time, so the local model can finish).
 */
export async function draftInterviewAnswers(o: { budgetMs: number; sequential: boolean }): Promise<DraftResult | { error: string }> {
  const profile = await getProfile();
  if (profile.experience.length === 0) return { error: "Import and confirm your profile first" };
  const have = must<{ key: string; answer: string }[]>(await db().from("answer_bank").select("key,answer"), "load answer bank");
  const answered = new Set(have.filter((h) => h.answer.trim()).map((h) => h.key));
  const todo = WRITTEN_QUESTIONS.filter((q) => !answered.has(answerKey(q)));
  if (todo.length === 0) return { written: 0, dropped: [], note: "Every interview question already has your answer" };

  const facts = richFacts(profile);
  const groups: string[][] = [];
  for (let i = 0; i < todo.length; i += 5) groups.push(todo.slice(i, i + 5));
  const one = async (qs: string[]) => {
    try {
      const { output } = await runStructured({ task: "tailor", schema: WrittenAnswers, system: WRITTEN_SYSTEM, prompt: writtenPrompt(profile, qs), prefer: "strong", budgetMs: o.budgetMs });
      return usableWritten(qs, output, facts);
    } catch (e) {
      const why = e instanceof Error ? e.message.split("\n")[0].slice(0, 160) : "the models did not answer";
      return { kept: [], dropped: qs.map((question): Dropped => ({ question, why: `no model could write it (${why})` })) };
    }
  };
  const results = o.sequential ? [] as Awaited<ReturnType<typeof one>>[] : await Promise.all(groups.map(one));
  if (o.sequential) for (const g of groups) results.push(await one(g));
  const kept = results.flatMap((r) => r.kept);
  const dropped = results.flatMap((r) => r.dropped);
  if (kept.length) {
    must(await db().from("answer_bank").upsert(kept.map((k) => ({ key: answerKey(k.question), question: k.question, answer: k.answer, updated_at: new Date().toISOString() })), { onConflict: "key" }).select("key"), "save drafted answers");
    await logConfig("Interview answers drafted from the profile", { written: kept.length, dropped: dropped.length });
  }
  return { written: kept.length, dropped, note: `${kept.length} answer${kept.length === 1 ? "" : "s"} written${dropped.length ? `; ${dropped.length} left for you (${dropped.map((d) => d.why).slice(0, 2).join("; ")}${dropped.length > 2 ? "; ..." : ""})` : ""}` };
}
