/** Questions that come up in most applications (India-heavy, with global ones). Answer once; reused everywhere. */
export type StandardQuestion = { question: string; group: string; hint?: string };

export const STANDARD_QUESTIONS: StandardQuestion[] = [
  { group: "Pay and availability", question: "What is your current CTC?", hint: "e.g. 24 LPA" },
  { group: "Pay and availability", question: "What is your expected CTC?", hint: "e.g. 32 LPA" },
  { group: "Pay and availability", question: "What is your notice period?", hint: "e.g. 60 days" },
  { group: "Pay and availability", question: "Is your notice period negotiable?", hint: "Yes / No / buy-out possible" },
  { group: "Pay and availability", question: "When can you join? (earliest start date)", hint: "e.g. Within 60 days" },
  { group: "Pay and availability", question: "Do you have any other offers in hand?", hint: "Yes / No" },
  { group: "Experience", question: "Total years of experience", hint: "A number, e.g. 6" },
  { group: "Experience", question: "Relevant years of experience for this role", hint: "A number, e.g. 5" },
  { group: "Experience", question: "Current company" },
  { group: "Experience", question: "Current job title" },
  { group: "Experience", question: "Why are you looking for a change?", hint: "One honest sentence" },
  { group: "Location and work style", question: "Current location", hint: "City, country" },
  { group: "Location and work style", question: "Preferred work location", hint: "Cities you would work in" },
  { group: "Location and work style", question: "Are you willing to relocate?", hint: "Yes / No" },
  { group: "Location and work style", question: "Are you comfortable working from office or hybrid?", hint: "Yes / No / remote only" },
  { group: "Location and work style", question: "Are you comfortable with rotational or night shifts?", hint: "Yes / No" },
  { group: "Work authorisation", question: "Are you legally authorised to work in this country?", hint: "Yes / No (add the country if needed)" },
  { group: "Work authorisation", question: "Will you require visa sponsorship?", hint: "Yes / No" },
  { group: "Work authorisation", question: "Citizenship / nationality", hint: "e.g. Indian" },
  { group: "Education", question: "Highest qualification", hint: "e.g. MBA" },
  { group: "Education", question: "University or college" },
  { group: "Education", question: "Year of graduation" },
  { group: "Online presence", question: "LinkedIn profile URL" },
  { group: "Online presence", question: "Portfolio or website" },
  { group: "Online presence", question: "GitHub profile" },
  { group: "Other", question: "How did you hear about this job?", hint: "e.g. Company website / LinkedIn" },
  { group: "Other", question: "Which languages do you speak?", hint: "e.g. English, Hindi" },
  { group: "Other", question: "Have you worked for or applied to this company before?", hint: "Yes / No" },
  { group: "Other", question: "Are you comfortable with a background verification?", hint: "Yes / No" },
  { group: "Optional diversity questions (leave blank to skip)", question: "Gender", hint: "Or 'Prefer not to say'" },
  { group: "Optional diversity questions (leave blank to skip)", question: "Disability status", hint: "Or 'Prefer not to say'" },
  { group: "Optional diversity questions (leave blank to skip)", question: "Veteran status", hint: "Or 'Prefer not to say'" },
];

const norm = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type AnswerRow = { question: string; answer: string; standard?: boolean; hint?: string; group?: string };

/** Saved answers first, then every standard question you have not answered yet (blank, with a hint). */
export function mergeStandard(saved: { question: string; answer: string }[]): AnswerRow[] {
  const have = new Set(saved.map((s) => norm(s.question)));
  const std = new Map(STANDARD_QUESTIONS.map((s) => [norm(s.question), s]));
  const rows: AnswerRow[] = saved.map((s) => {
    const m = std.get(norm(s.question));
    return { ...s, standard: !!m, hint: m?.hint, group: m?.group };
  });
  for (const s of STANDARD_QUESTIONS) if (!have.has(norm(s.question))) rows.push({ question: s.question, answer: "", standard: true, hint: s.hint, group: s.group });
  return rows;
}

/** What to persist: anything answered, plus custom questions you added (even if blank). Unanswered standard rows are re-offered on next load. */
export function rowsToSave(rows: AnswerRow[]): { question: string; answer: string }[] {
  return rows.filter((r) => r.question.trim() && (r.answer.trim() || !r.standard)).map((r) => ({ question: r.question.trim(), answer: r.answer.trim() }));
}

/** Add or remove a value in a comma-separated list (used by the quick-add chips on Settings). */
export function toggleCsv(current: string, value: string): string {
  const items = current.split(",").map((x) => x.trim()).filter(Boolean);
  const i = items.findIndex((x) => x.toLowerCase() === value.toLowerCase());
  if (i >= 0) items.splice(i, 1); else items.push(value);
  return items.join(", ");
}

export const COUNTRY_PRESETS = [
  { code: "in", name: "India" }, { code: "sg", name: "Singapore" }, { code: "ae", name: "UAE" }, { code: "gb", name: "United Kingdom" },
  { code: "us", name: "United States" }, { code: "au", name: "Australia" }, { code: "ca", name: "Canada" }, { code: "de", name: "Germany" },
  { code: "nl", name: "Netherlands" }, { code: "ie", name: "Ireland" },
];

export const ROLE_PRESETS = [
  "Product Manager", "Senior Product Manager", "Program Manager", "Project Manager", "Business Analyst", "Data Analyst",
  "Software Engineer", "Frontend Engineer", "Backend Engineer", "Data Scientist", "UX Designer", "Marketing Manager",
  "Operations Manager", "Customer Success Manager", "Account Manager", "Finance Manager",
];
