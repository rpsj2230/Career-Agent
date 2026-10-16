import type { MasterProfile } from "@/lib/types";

export type Answer = { question: string; answer: string; source: "answer_bank" | "profile" };

const NOW_YEAR = () => new Date().getFullYear();

/** Whole years between the earliest start year and the latest end year (or now when "Present"); null if no dates parse. */
export function estimateYears(experience: MasterProfile["experience"], nowYear = NOW_YEAR()): number | null {
  let min = Infinity, max = -Infinity;
  for (const e of experience) {
    const start = e.start?.match(/\b(19|20)\d{2}\b/)?.[0];
    const end = /present|current|now|till date/i.test(e.end ?? "") ? String(nowYear) : e.end?.match(/\b(19|20)\d{2}\b/)?.[0];
    if (start) min = Math.min(min, +start);
    if (end) max = Math.max(max, +end);
  }
  return Number.isFinite(min) && Number.isFinite(max) && max >= min ? max - min : null;
}

/** Facts we already know from the profile, offered when the form asks and the answer bank has no answer. */
export function deriveProfileAnswers(p: MasterProfile, nowYear = NOW_YEAR()): { question: string; answer: string; re: RegExp }[] {
  const out: { question: string; answer: string; re: RegExp }[] = [];
  const add = (question: string, answer: string | undefined, re: RegExp) => { if (answer?.trim()) out.push({ question, answer: answer.trim(), re }); };
  const years = estimateYears(p.experience, nowYear);
  if (years !== null) add("Total years of experience", String(years), /total.*(years|experience)|years of (total )?experience/i);
  add("Current company", p.experience.find((e) => /present|current/i.test(e.end ?? ""))?.company ?? p.experience[0]?.company, /current.*(company|employer)/i);
  add("Current job title", p.experience.find((e) => /present|current/i.test(e.end ?? ""))?.title ?? p.experience[0]?.title, /current.*(title|designation|role)/i);
  add("Current location", p.basics.location, /current.*location|where.*(based|located)/i);
  add("LinkedIn profile URL", p.basics.links.find((l) => /linkedin\.com/i.test(l)), /linkedin/i);
  add("GitHub profile", p.basics.links.find((l) => /github\.com/i.test(l)), /github/i);
  add("Portfolio or website", p.basics.links.find((l) => !/linkedin\.com|github\.com/i.test(l)), /portfolio|website/i);
  const ed = p.education[0];
  add("Highest qualification", ed?.degree, /highest.*(qualification|education|degree)/i);
  add("University or college", ed?.school, /university|college|school|institution/i);
  add("Year of graduation", ed?.end?.match(/\b(19|20)\d{2}\b/)?.[0], /graduation|passing.*year|year of (passing|completion)/i);
  return out;
}

/** Answer bank first; common India/visa questions are filled from profile preferences when not in the bank. */
export function buildAnswers(bank: { question: string; answer: string }[], prefs: MasterProfile["preferences"], profile?: MasterProfile): Answer[] {
  const out: Answer[] = bank.filter((b) => b.answer.trim()).map((b) => ({ question: b.question, answer: b.answer, source: "answer_bank" as const }));
  const has = (re: RegExp) => out.some((a) => re.test(a.question));
  const add = (question: string, answer: string | undefined, re: RegExp) => {
    if (answer && !has(re)) out.push({ question, answer, source: "profile" });
  };
  add("Current CTC", prefs.currentCtc, /current.*(ctc|salary)/i);
  add("Expected CTC", prefs.expectedCtc, /expected.*(ctc|salary)/i);
  add("Notice period", prefs.noticePeriod, /notice/i);
  add("Work authorisation / visa status", prefs.visaStatus, /visa|authori[sz]ation/i);
  if (prefs.relocate !== undefined) add("Willing to relocate?", prefs.relocate ? "Yes" : "No", /relocat/i);
  if (profile) for (const d of deriveProfileAnswers(profile)) add(d.question, d.answer, d.re);
  return out;
}
