import { runText } from "@/lib/llm/registry";
import { loadHandbacks } from "@/lib/apply/handbacks-store";
import { saveAnswerAndRequeue } from "@/lib/apply/save-answer";
import { asCount, wantsNumber } from "@/lib/apply/skill-years";
import { cleanProse, richFacts, ungroundedFigure } from "@/lib/autofill/written-answers";
import { db, must } from "@/lib/db";
import { getProfile } from "@/lib/profile/store";
import { getSetting, putSetting } from "@/lib/settings";

/** Questions a model must never guess at: they are about pay, rights, identity or the law, and a wrong answer can cost more than a missed application. They wait for you. */
export const LEFT_FOR_YOU = /\b(visa|work (permit|authori[sz]ation)|right to work|sponsor\w*|salary|ctc|compensation|remuneration|notice period|date of birth|\bage\b|gender|ethnic\w*|\brace\b|disabilit\w*|veteran|religio\w*|marital|citizen\w*|nationality|criminal|convict\w*|background check|drug test|security clearance|signature)\b/i;

export const WAITING_SYSTEM = `You answer one question from a job application form for the candidate described in FACTS.
Rules:
- Use only the FACTS and the ANSWER BANK. Never invent an employer, title, degree, certificate, number, date, tool or skill.
- Give the shortest correct answer: a number for "how many", a few words for a short question. Write 2 to 4 honest sentences in the first person only when the question asks you to describe or explain something.
- Yes or No only when the FACTS show it. Never answer about pay, visas, work rights, identity or legal matters.
- Reply with the answer text only: no label, no quotation marks, no explanation.
- If you cannot answer truthfully from the FACTS and the ANSWER BANK, reply exactly NO_ANSWER. That is better than a guess.`;

export type WaitingResult = { answered: number; requeued: number; left: { question: string; why: string }[]; errors: string[] };

/**
 * The cloud's turn when the assistant on the Mac could not answer a form question (its models were out of reach or out of tokens): the question is put to the
 * runner's models, hosted first and the local model last, from your profile only. A usable answer goes into your answer bank and the waiting applications go back
 * to the assistant's queue. Anything doubtful, or about pay, rights or identity, stays with you. Each question is tried once a day at most.
 */
export async function answerWaitingQuestions(o: { budgetMs: number; sequential: boolean }): Promise<WaitingResult> {
  const out: WaitingResult = { answered: 0, requeued: 0, left: [], errors: [] };
  const groups = (await loadHandbacks()).slice(0, 25);
  if (!groups.length) return out;
  const profile = await getProfile();
  if (!profile.experience.length) return out;
  const facts = richFacts(profile);
  const bank = must<{ question: string; answer: string }[]>(await db().from("answer_bank").select("question,answer").limit(200), "load answer bank").filter((b) => b.answer.trim() && b.answer.length <= 200);
  const bankText = bank.length ? bank.map((b) => `- ${b.question}: ${b.answer}`).join("\n") : "(empty)";
  const tried = { ...(await getSetting("ai_answer_tried")) };
  const dayAgo = Date.now() - 24 * 3600_000;
  const deadline = Date.now() + o.budgetMs;

  for (const g of groups) {
    if (LEFT_FOR_YOU.test(g.question)) { out.left.push({ question: g.question, why: "it is about pay, rights, identity or the law, so it is left for you" }); continue; }
    if (tried[g.key] && new Date(tried[g.key]).getTime() > dayAgo) { out.left.push({ question: g.question, why: "the AI already could not answer it today" }); continue; }
    if (Date.now() > deadline - 5_000) { out.left.push({ question: g.question, why: "not reached before the time limit" }); continue; }
    const job = g.apps.length === 1 ? `JOB: ${g.apps[0].title} at ${g.apps[0].company}\n` : "";
    try {
      const { text } = await runText({ task: "tailor", system: WAITING_SYSTEM, prompt: `${job}FACTS:\n${facts}\n\nANSWER BANK:\n${bankText}\n\nQUESTION: ${g.question}`, prefer: "strong", budgetMs: Math.min(o.sequential ? 240_000 : 40_000, deadline - Date.now()), skipParked: true });
      let answer = cleanProse(text).replace(/\s+/g, " ").trim();
      if (wantsNumber(g.question)) answer = asCount(answer);
      const bad = !answer || /^(null|none|n\/a|unknown|no[_ ]answer)\.?$/i.test(answer) ? "the profile does not answer it" : /\[[^\]]+\]|\{\{/.test(answer) ? "the draft contained a placeholder" : ungroundedFigure(answer, `${facts}\n${bankText}`) ? "the draft stated a figure that is not in your profile" : answer.length > 1200 ? "the draft was too long" : null;
      if (bad) { tried[g.key] = new Date().toISOString(); out.left.push({ question: g.question, why: bad }); continue; }
      const r = await saveAnswerAndRequeue({ question: g.question, answer, country: null, appIds: g.apps.map((a) => a.id), by: "ai" });
      out.answered++; out.requeued += r.requeued;
    } catch (e) {
      out.errors.push((e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 600));
      out.left.push({ question: g.question, why: "no model could write it" });
    }
  }
  await putSetting("ai_answer_tried", Object.fromEntries(Object.entries(tried).filter(([, t]) => new Date(t).getTime() > dayAgo))).catch(() => undefined);
  return out;
}

