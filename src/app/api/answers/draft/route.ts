import { NextResponse } from "next/server";
import { logConfig } from "@/lib/activity-helpers";
import { db, must } from "@/lib/db";
import { runStructured } from "@/lib/llm/registry";
import { WrittenAnswers, richFacts, usableWritten, writtenPrompt, WRITTEN_SYSTEM, type Dropped } from "@/lib/autofill/written-answers";
import { getProfile } from "@/lib/profile/store";
import { WRITTEN_QUESTIONS } from "@/lib/standard-questions";

export const maxDuration = 60;

const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

/**
 * "Write the interview answers from my profile": drafts the standard interview questions that have no answer yet, from the profile only, and saves
 * them in the answer bank, where they can be edited. An answer you already wrote is never touched. Answers that state a figure the profile does
 * not contain are not saved (they are listed, so you can write them yourself).
 */
export async function POST() {
  const profile = await getProfile();
  if (profile.experience.length === 0) return NextResponse.json({ error: "Import and confirm your profile first" }, { status: 409 });
  const have = must<{ key: string; answer: string }[]>(await db().from("answer_bank").select("key,answer"), "load answer bank");
  const answered = new Set(have.filter((h) => h.answer.trim()).map((h) => h.key));
  const todo = WRITTEN_QUESTIONS.filter((q) => !answered.has(slug(q)));
  if (todo.length === 0) return NextResponse.json({ ok: true, written: 0, dropped: [], note: "Every interview question already has your answer" });

  const facts = richFacts(profile);
  const groups: string[][] = [];
  for (let i = 0; i < todo.length; i += 5) groups.push(todo.slice(i, i + 5));
  // the groups run side by side so the whole set fits in one request; each group falls back across models on its own
  const results = await Promise.all(groups.map(async (qs) => {
    try {
      const { output } = await runStructured({ task: "tailor", schema: WrittenAnswers, system: WRITTEN_SYSTEM, prompt: writtenPrompt(profile, qs), prefer: "strong", budgetMs: 50_000 });
      return usableWritten(qs, output, facts);
    } catch (e) {
      const why = e instanceof Error ? e.message.split("\n")[0].slice(0, 160) : "the models did not answer";
      return { kept: [], dropped: qs.map((question): Dropped => ({ question, why: `no model could write it (${why})` })) };
    }
  }));
  const kept = results.flatMap((r) => r.kept);
  const dropped = results.flatMap((r) => r.dropped);
  if (kept.length) {
    must(await db().from("answer_bank").upsert(kept.map((k) => ({ key: slug(k.question), question: k.question, answer: k.answer, updated_at: new Date().toISOString() })), { onConflict: "key" }).select("key"), "save drafted answers");
    await logConfig("Interview answers drafted from the profile", { written: kept.length, dropped: dropped.length });
  }
  return NextResponse.json({ ok: true, written: kept.length, dropped, note: `${kept.length} answer${kept.length === 1 ? "" : "s"} written${dropped.length ? `; ${dropped.length} left for you (${dropped.map((d) => d.why).slice(0, 2).join("; ")}${dropped.length > 2 ? "; ..." : ""})` : ""}` });
}
