/**
 * Questions the agent could not answer. When an application is handed back ("Needs you: ..."), the unanswered questions are
 * collected here, grouped by wording across all applications, so each can be answered once and used from then on.
 */
export type HandbackApp = { id: string; title: string; company: string; country: string | null; unanswered: string[] };
export type HandbackGroup = { key: string; question: string; count: number; apps: { id: string; title: string; company: string }[]; countries: string[] };

/** Strip the decorations forms and the worker add to a question label. Returns null for things you must do yourself or that are errors, not questions. */
export function cleanQuestion(raw: string): string | null {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/you must tick this yourself/i.test(s)) return null; // consent boxes are never answered for you
  if (/\((locator|strict mode|error|timeout|Error:)/i.test(s) || /^file upload$/i.test(s)) return null;
  const q = s.replace(/\s*[✱*]+\s*$/u, "").replace(/\s*\((required|optional)\)\s*$/i, "").replace(/\s*\*$/, "").trim();
  return q.length >= 3 && q.length <= 300 ? q : null;
}

export const questionKey = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Group the unanswered questions across applications; the most common first. */
export function groupHandbacks(apps: HandbackApp[]): HandbackGroup[] {
  const groups = new Map<string, HandbackGroup>();
  for (const a of apps) {
    for (const raw of a.unanswered) {
      const q = cleanQuestion(raw);
      if (!q) continue;
      const key = questionKey(q);
      const g = groups.get(key) ?? { key, question: q, count: 0, apps: [], countries: [] };
      if (g.apps.some((x) => x.id === a.id)) continue;
      g.count++;
      g.apps.push({ id: a.id, title: a.title, company: a.company });
      if (a.country && !g.countries.includes(a.country)) g.countries.push(a.country);
      groups.set(key, g);
    }
  }
  return [...groups.values()].sort((x, y) => y.count - x.count || x.question.localeCompare(y.question));
}

/** The answer list of an application with this question answered (any earlier entry for the same question is replaced). */
export function withAnswer(answers: { question: string; answer: string; source: string }[], question: string, answer: string) {
  const k = questionKey(question);
  return [...answers.filter((a) => questionKey(a.question) !== k), { question, answer, source: "answer_bank" }];
}

/** The question as it is stored when the answer is only for one country: the worker answers it only on that country's forms. */
export const scopedQuestion = (question: string, countryName: string | null) => (countryName && !new RegExp(`\\b${countryName}\\b`, "i").test(question) ? `${question} (${countryName})` : question);

/**
 * Where an application goes once its question is answered. One that the assistant on your computer handed back, and that you had already
 * approved, goes straight back to the assistant's queue (it was cleared to send; only the answer was missing). Anything else returns to
 * "prepared", to be approved as usual.
 */
export function requeueStatus(row: { approved_at: string | null }, lastHandback: { assistant?: boolean } | null): "assisted_pending" | "prepared" {
  return row.approved_at && lastHandback?.assistant === true ? "assisted_pending" : "prepared";
}

/**
 * The questions named in a hand-back's own text ("Needs you: A; B"), for applications whose record did not keep the list.
 * Only that exact form is read; any other reason (a page with no form, a sign-in wall) names no question.
 */
export function questionsInReason(error: string | null | undefined): string[] {
  const m = (error ?? "").match(/^\s*Needs you:\s*([\s\S]+)$/i);
  return m ? m[1].split(/;\s+/).map((x) => x.trim()).filter(Boolean) : [];
}
