import { COUNTRIES } from "@/lib/countries";

/**
 * Pay and visa answers are true for one country only: "24 LPA" means nothing on a Singapore form, and "Indian citizen" is not
 * a work authorisation for Germany. These rules keep such answers out of forms in other countries. Anything else (notice period,
 * years of experience, links) is the same everywhere.
 */
export const COUNTRY_SENSITIVE = /\b(ctc|salary|salaries|compensation|remuneration|pay|wage)\b|visa|authori[sz]ation|sponsor|right to work|eligible to work|work permit/i;

const NAMES = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c.code]));

/** The country an answer was saved for, when its question ends with "(Country)" (see scopedQuestion). */
export function scopeCountry(question: string): string | null {
  const m = question.match(/\(([^()]+)\)\s*$/);
  return m ? NAMES.get(m[1].trim().toLowerCase()) ?? null : null;
}

const base = (q: string) => q.replace(/\s*\([^()]+\)\s*$/, "").trim().toLowerCase();

/** Which country your current pay is in: set explicitly, otherwise read from how you wrote it ("24 LPA" is India). Unknown = no filtering. */
export function inferPayCountry(prefs: { payCountry?: string; currentCtc?: string; expectedCtc?: string }): string | undefined {
  if (prefs.payCountry && /^[a-z]{2}$/i.test(prefs.payCountry)) return prefs.payCountry.toLowerCase();
  const t = `${prefs.currentCtc ?? ""} ${prefs.expectedCtc ?? ""}`;
  if (/\b(lpa|lakhs?|lacs?|crores?|inr)\b|₹|\brs\.?\s*\d/i.test(t)) return "in";
  if (/\bsgd\b|\bS\$/i.test(t)) return "sg";
  if (/\baed\b|dirhams?/i.test(t)) return "ae";
  if (/\baud\b|\bA\$/i.test(t)) return "au";
  if (/\bcad\b|\bC\$/i.test(t)) return "ca";
  if (/\bgbp\b|£/i.test(t)) return "gb";
  if (/\busd\b|\bUS\$/i.test(t)) return "us";
  return undefined;
}

/** Is a general (unscoped) pay or visa answer usable for a job in `jobCountry`? Only where it was written, or when either country is unknown. */
export const generalPayAllowed = (jobCountry: string | null | undefined, payCountry: string | undefined) => !jobCountry || !payCountry || jobCountry.toLowerCase() === payCountry;

/**
 * The answer bank as it applies to one job. An entry saved for one country is used only on that country's forms and replaces the
 * general version of the same question; a general pay or visa entry is dropped on forms from another country (so the form is handed back
 * to you for that country's answer instead of getting the wrong one).
 */
export function bankForJob<T extends { question: string; answer: string }>(bank: T[], jobCountry: string | null | undefined, payCountry: string | undefined): T[] {
  const job = jobCountry?.toLowerCase();
  const scopedHere = new Set(bank.filter((b) => scopeCountry(b.question) && scopeCountry(b.question) === job).map((b) => base(b.question)));
  return bank.filter((b) => {
    const scope = scopeCountry(b.question);
    if (scope) return scope === job;
    if (!COUNTRY_SENSITIVE.test(b.question)) return true;
    if (scopedHere.has(base(b.question))) return false;
    return generalPayAllowed(job, payCountry);
  });
}
