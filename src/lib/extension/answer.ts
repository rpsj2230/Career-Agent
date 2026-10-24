import "server-only";
import { z } from "zod";
import { LEFT_FOR_YOU, WAITING_SYSTEM } from "@/lib/apply/answer-waiting";
import { cleanQuestion, questionKey } from "@/lib/apply/handbacks";
import { saveAnswerAndRequeue } from "@/lib/apply/save-answer";
import { asCount, wantsNumber } from "@/lib/apply/skill-years";
import { cleanProse, richFacts, ungroundedFigure } from "@/lib/autofill/written-answers";
import { db, must } from "@/lib/db";
import { runText } from "@/lib/llm/registry";
import { getProfile } from "@/lib/profile/store";
import { getSetting, putSetting } from "@/lib/settings";
import { matchAnswer } from "../../../worker/match";

export const AskedQuestions = z.object({
  questions: z.array(z.object({ question: z.string().trim().min(2).max(400), options: z.array(z.string().max(200)).max(60).default([]), kind: z.string().max(20).default("text") })).min(1).max(8),
});
export type AnswerResult = { question: string; answer: string | null; why: string; source: "saved" | "ai" | "none" };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();
/** The option a free answer means ("Yes, I do" → "Yes"), or null when it names none of them. */
export function chooseOption(options: string[], answer: string): string | null {
  const a = norm(answer);
  if (!a) return null;
  const opts = options.map((o) => ({ o, n: norm(o) }));
  const yn = /^(yes|y|true)\b/.test(a) ? "yes" : /^(no|n|false)\b/.test(a) ? "no" : null;
  return (opts.find((x) => x.n === a) ?? (yn ? opts.find((x) => x.n.startsWith(yn)) : undefined) ?? opts.find((x) => x.n.length > 2 && (x.n.includes(a) || a.includes(x.n))))?.o ?? null;
}

const OPTION_RULE = `\nIf OPTIONS are given, reply with the text of exactly one option (or, for a "select all that apply" question, the options that are true, separated by semicolons). Never reply with anything that is not one of the options.`;

/**
 * The browser extension met questions on a form that your own data could not answer. For each: your saved answers (including another wording of the same question), then,
 * for anything that is not about pay, rights, identity or the law, the AI models from your profile alone, which may only answer what the profile and saved answers show.
 * An answer the AI gives is saved in your answer bank (you can edit it there), so the same question, in any wording, is answered at once next time. Everything else is left for you.
 */
export async function answerForExtension(asked: z.infer<typeof AskedQuestions>["questions"], budgetMs = 45_000): Promise<AnswerResult[]> {
  const results: AnswerResult[] = [];
  const bank = must<{ question: string; answer: string }[]>(await db().from("answer_bank").select("question,answer").limit(300), "load answer bank").filter((b) => b.answer.trim());
  const deadline = Date.now() + budgetMs;
  let profileFacts: string | null = null;
  const tried = { ...(await getSetting("ai_answer_tried")) };
  const dayAgo = Date.now() - 24 * 3600_000;
  let triedChanged = false;
  for (const q of asked) {
    const question = cleanQuestion(q.question);
    if (!question) { results.push({ question: q.question, answer: null, why: "it is something only you may type", source: "none" }); continue; }
    const saved = matchAnswer(question, bank);
    if (saved) { results.push({ question, answer: (q.options.length && chooseOption(q.options, saved)) || saved, why: "from your saved answers", source: "saved" }); continue; }
    if (LEFT_FOR_YOU.test(question)) { results.push({ question, answer: null, why: "it is about pay, rights, identity or the law, so it is left for you", source: "none" }); continue; }
    const key = questionKey(question);
    if (tried[key] && new Date(tried[key]).getTime() > dayAgo) { results.push({ question, answer: null, why: "the AI could not answer it earlier today", source: "none" }); continue; }
    if (Date.now() > deadline - 5_000) { results.push({ question, answer: null, why: "not reached before the time limit", source: "none" }); continue; }
    try {
      if (profileFacts === null) { const profile = await getProfile(); profileFacts = profile.experience.length ? richFacts(profile) : ""; }
      if (!profileFacts) { results.push({ question, answer: null, why: "your profile is empty", source: "none" }); continue; }
      const bankText = bank.filter((b) => b.answer.length <= 200).slice(0, 150).map((b) => `- ${b.question}: ${b.answer}`).join("\n") || "(empty)";
      const options = q.options.filter((o) => o.trim());
      const { text } = await runText({
        task: "tailor", system: WAITING_SYSTEM + (options.length ? OPTION_RULE : ""), prefer: "strong", budgetMs: Math.min(30_000, deadline - Date.now()), skipParked: true,
        prompt: `FACTS:\n${profileFacts}\n\nANSWER BANK:\n${bankText}\n\nQUESTION: ${question}${options.length ? `\nOPTIONS: ${options.join(" | ")}` : ""}`,
      });
      let answer = cleanProse(text).replace(/\s+/g, " ").trim();
      if (wantsNumber(question)) answer = asCount(answer);
      let bad: string | null = !answer || /^(null|none|n\/a|unknown|no[_ ]answer)\.?$/i.test(answer) ? "the profile does not answer it" : null;
      if (!bad && options.length) {
        const picked = answer.includes(";") ? answer.split(";").map((p) => chooseOption(options, p.trim())).filter((x): x is string => !!x) : [chooseOption(options, answer)].filter((x): x is string => !!x);
        if (!picked.length) bad = "the answer was not one of the options"; else answer = [...new Set(picked)].join("; ");
      }
      if (!bad && /\[[^\]]+\]|\{\{/.test(answer)) bad = "the draft contained a placeholder";
      if (!bad && ungroundedFigure(answer, `${profileFacts}\n${bankText}\n${options.join(" ")}`)) bad = "the draft stated a figure that is not in your profile";
      if (!bad && answer.length > 700) bad = "the draft was too long";
      if (bad) { tried[key] = new Date().toISOString(); triedChanged = true; results.push({ question, answer: null, why: bad, source: "none" }); continue; }
      await saveAnswerAndRequeue({ question, answer, country: null, appIds: [], by: "ai" });
      results.push({ question, answer, why: "written by the AI from your profile and saved to your answer bank", source: "ai" });
    } catch (e) {
      results.push({ question, answer: null, why: "no model could answer it: " + (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 160), source: "none" });
    }
  }
  if (triedChanged) await putSetting("ai_answer_tried", Object.fromEntries(Object.entries(tried).filter(([, t]) => new Date(t).getTime() > dayAgo))).catch(() => undefined);
  return results;
}
