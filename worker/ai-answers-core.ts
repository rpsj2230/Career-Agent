import { z } from "zod";
import { estimateYears } from "../src/lib/apply/answers";
import type { MasterProfile } from "../src/lib/types";
import type { Pending } from "./form";
import type { Answer } from "./match";

/** What the model returns: one entry per question, null when the facts do not answer it. */
export const AiAnswers = z.object({ answers: z.array(z.object({ index: z.number().int(), answer: z.string().nullable() })) });

export const AI_SYSTEM = `You fill in a job application form for the candidate described in FACTS. Answer each numbered QUESTION.
Rules:
- Use only the FACTS and the ANSWER BANK. Never invent an employer, title, degree, certificate, number, date or skill.
- For a choice question (OPTIONS given) reply with exactly one of the options, copied as written.
- Yes/no questions: "Yes" only when the FACTS show it; "No" only when the question names a specific tool, licence, certificate or requirement that is clearly absent from the FACTS; otherwise null.
- Numbers (years of experience, notice period, salary): use only what the FACTS state or what the ANSWER BANK says; otherwise null. Pay and work-authorisation questions are answered only from the ANSWER BANK or PREFERENCES for the right country; otherwise null.
- Gender, race, ethnicity, disability, veteran status, age, date of birth, religion, marital status: choose the option that means "prefer not to say" or "decline to answer"; if there is none, null.
- Open questions (why this role, why this company, tell us about yourself, relevant experience): write 2 to 5 honest sentences in the first person that connect the candidate's real experience in FACTS to the JOB. No exaggeration, no claims that are not in the FACTS.
- If you cannot answer truthfully, answer null. A null is better than a guess.
Reply with JSON only: {"answers":[{"index":0,"answer":"..."}]}`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

/** A compact, factual description of the candidate: nothing here is more than what the profile already says. */
export function factsFor(p: MasterProfile): string {
  const years = estimateYears(p.experience);
  const prefs = p.preferences;
  return [
    `Name: ${p.basics.name}. Location: ${p.basics.location || "not given"}.`,
    years !== null ? `Total years of experience (from first start to now): ${years}.` : "",
    "Roles: " + p.experience.map((e) => `${e.title} at ${e.company} (${e.start ?? "?"} to ${e.end ?? "?"})`).join("; "),
    "Most recent achievements: " + p.experience.slice(0, 2).flatMap((e) => e.bullets.slice(0, 4).map((b) => b.text)).map((t) => clip(t, 200)).join(" | "),
    "Education: " + p.education.map((e) => `${e.degree ?? ""} ${e.school ?? ""}`.trim()).join("; "),
    "Skills: " + p.skills.map((s) => s.name).slice(0, 80).join(", "),
    p.certifications.length ? "Certifications: " + p.certifications.map((c) => c.name).join(", ") : "",
    `PREFERENCES: notice period ${prefs.noticePeriod ?? "not given"}; visa/work authorisation ${prefs.visaStatus ?? "not given"}; relocate ${prefs.relocate === undefined ? "not given" : prefs.relocate ? "yes" : "no"}.`,
  ].filter(Boolean).join("\n");
}

export function buildAiPrompt(o: { profile: MasterProfile; bank: Answer[]; job: { title: string; company: string; description?: string | null }; pending: Pending[] }): string {
  return [
    `JOB: ${o.job.title} at ${o.job.company}`,
    o.job.description ? `JOB DESCRIPTION (excerpt): ${clip(o.job.description.replace(/\s+/g, " "), 1500)}` : "",
    `FACTS:\n${factsFor(o.profile)}`,
    `ANSWER BANK:\n${o.bank.length ? o.bank.map((a) => `- ${a.question}: ${a.answer}`).join("\n") : "(empty)"}`,
    "QUESTIONS:",
    ...o.pending.map((q, i) => `${i}. [${q.type}] ${q.label}${q.options.length ? ` OPTIONS: ${q.options.map((o) => JSON.stringify(o)).join(" | ")}` : ""}`),
  ].filter(Boolean).join("\n");
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Keep only answers that can be used: a choice must be one of the options, text is trimmed and bounded, a "null" word is no answer. */
export function usableAnswers(pending: Pending[], out: z.infer<typeof AiAnswers>): Answer[] {
  const res: Answer[] = [];
  for (const a of out.answers) {
    const q = pending[a.index];
    if (!q || a.answer == null) continue;
    let text = a.answer.trim();
    if (!text || /^(null|none|n\/a|unknown|not (given|provided|specified))$/i.test(text)) continue;
    if (q.options.length) {
      const hit = q.options.find((o) => norm(o) === norm(text)) ?? q.options.find((o) => norm(o).includes(norm(text)) || norm(text).includes(norm(o)));
      if (!hit) continue;
      text = hit;
    }
    if (q.type === "number" && !/^\d+(\.\d+)?$/.test(text)) { const m = text.match(/\d+(\.\d+)?/); if (!m) continue; text = m[0]; }
    res.push({ question: q.label, answer: text.slice(0, q.type === "textarea" ? 2000 : 300) });
  }
  return res;
}

/** The questions not yet put to a model during this application: the same question is not asked again on every page of a form that did not move on. */
export function newQuestions(pending: Pending[], asked: Set<string>): Pending[] {
  const fresh = pending.filter((q) => !asked.has(norm(q.label)));
  for (const q of fresh) asked.add(norm(q.label));
  return fresh;
}
