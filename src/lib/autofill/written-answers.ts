import { z } from "zod";
import { estimateYears } from "@/lib/apply/answers";
import type { MasterProfile } from "@/lib/types";

/**
 * Interview-style answers ("Why should we hire you?", "Describe a time you resolved a conflict") written from the profile, for the answer bank.
 * Pure: the model call and the saving live in the route. Nothing is invented: the model is told to answer null when the profile does not
 * show the substance, and any answer that states a figure the profile does not contain is dropped.
 */
export const WrittenAnswers = z.object({ answers: z.array(z.object({ index: z.number().int(), answer: z.string().nullable() })) });

export const WRITTEN_SYSTEM = `You write short interview answers for the candidate described in FACTS, in the first person, for reuse on many job applications. Answer each numbered QUESTION.
Rules:
- Use only the FACTS. Never invent an employer, title, team size, number, percentage, date, tool, certificate or outcome. Every figure you write must appear in the FACTS.
- 3 to 5 sentences, at most 700 characters, plain professional English, no headings, no bullet points, no placeholders.
- The answer is reused for any employer: never name the employer being applied to, and never claim knowledge of a company. For "why this company" write what draws the candidate to organisations of that kind, grounded in the FACTS.
- "Why change jobs" is positive and honest: growth in scope or craft that follows from the career in FACTS. Never claim dissatisfaction, layoffs, conflict with a manager or personal circumstances.
- "An area you are working to improve" is a real, modest development area that the FACTS support (for example a newer skill the candidate is adding); if the FACTS give nothing to base it on, answer null.
- Situation questions (a project, a conflict, a process improvement, competing priorities): describe one real example taken from the roles or achievements in FACTS, with what the candidate did and the result stated in FACTS. If FACTS hold no suitable example, answer null.
- If the FACTS do not support an honest answer, answer null. A null is better than a guess.
Reply with JSON only: {"answers":[{"index":0,"answer":"..."}]}`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

/** Everything the profile says, compactly: more of it than a form answer needs, because these answers draw on real examples. */
export function richFacts(p: MasterProfile): string {
  const years = estimateYears(p.experience);
  return [
    `Name: ${p.basics.name}. Location: ${p.basics.location || "not given"}.`,
    p.basics.headline ? `Headline: ${p.basics.headline}` : "",
    p.basics.summary ? `Summary: ${clip(p.basics.summary, 600)}` : "",
    years !== null ? `Total years of experience: ${years}.` : "",
    ...p.experience.map((e) => `ROLE: ${e.title} at ${e.company} (${e.start ?? "?"} to ${e.end ?? "?"})\n${e.bullets.slice(0, 7).map((b) => `- ${clip(b.text, 240)}`).join("\n")}`),
    p.highlights.length ? `Career highlights:\n${p.highlights.slice(0, 8).map((h) => `- ${clip(h.text, 240)}`).join("\n")}` : "",
    p.caseStudies.length ? `Case studies: ${p.caseStudies.map((c) => c.title).join("; ")}` : "",
    p.sections.length ? p.sections.map((s) => `${s.title}: ${[s.intro, ...s.bullets.slice(0, 5).map((b) => `${b.label ? `${b.label}: ` : ""}${b.text}`)].filter(Boolean).map((t) => clip(String(t), 220)).join(" | ")}`).join("\n") : "",
    `Skills: ${p.skills.map((s) => s.name).slice(0, 80).join(", ")}`,
    p.certifications.length ? `Certifications: ${p.certifications.map((c) => c.name).join(", ")}` : "",
    p.education.length ? `Education: ${p.education.map((e) => `${e.degree ?? ""} ${e.school ?? ""}`.trim()).join("; ")}` : "",
    p.development.length ? `Professional development: ${p.development.map((d) => d.name).join("; ")}` : "",
    p.awards.length ? `Awards: ${p.awards.map((a) => a.name).join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

export function writtenPrompt(p: MasterProfile, questions: string[]): string {
  return [`FACTS:\n${richFacts(p)}`, "QUESTIONS:", ...questions.map((q, i) => `${i}. ${q}`)].join("\n");
}

const figures = (t: string) => (t.match(/\d[\d,.]*\s?%?/g) ?? []).map((x) => x.replace(/[,\s]/g, "").replace(/\.$/, ""));

/** Every number or percentage in the answer must also be in the facts. Returns the first one that is not, or null when all are grounded. */
export function ungroundedFigure(answer: string, facts: string): string | null {
  const known = new Set(figures(facts));
  return figures(answer).find((f) => !known.has(f)) ?? null;
}

export type Drafted = { question: string; answer: string };
export type Dropped = { question: string; why: string };

/** Keep the answers that are usable: not null, a sensible length, no ungrounded figure, no employer placeholder. */
export function usableWritten(questions: string[], out: z.infer<typeof WrittenAnswers>, facts: string): { kept: Drafted[]; dropped: Dropped[] } {
  const kept: Drafted[] = [], dropped: Dropped[] = [];
  const seen = new Set<number>();
  for (const a of out.answers) {
    const q = questions[a.index];
    if (!q || seen.has(a.index)) continue;
    seen.add(a.index);
    const text = (a.answer ?? "").replace(/\s+/g, " ").trim();
    if (!text || /^(null|none|n\/a|unknown)$/i.test(text)) { dropped.push({ question: q, why: "your profile does not give enough to answer this honestly" }); continue; }
    if (text.length < 40) { dropped.push({ question: q, why: "the draft was too short to use" }); continue; }
    if (/\[[^\]]+\]|\bXYZ\b|\{\{/.test(text)) { dropped.push({ question: q, why: "the draft contained a placeholder" }); continue; }
    const bad = ungroundedFigure(text, facts);
    if (bad) { dropped.push({ question: q, why: `the draft stated "${bad}", which is not in your profile` }); continue; }
    kept.push({ question: q, answer: text.slice(0, 1200) });
  }
  for (let i = 0; i < questions.length; i++) if (!seen.has(i)) dropped.push({ question: questions[i], why: "the model gave no answer" });
  return { kept, dropped };
}
