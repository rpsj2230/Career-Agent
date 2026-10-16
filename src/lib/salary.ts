import { COUNTRIES, defaultCurrency } from "./countries";

export type Period = "year" | "month" | "week" | "day" | "hour";
export type Salary = { min?: number; max?: number; currency?: string; period?: Period | null };

const ANNUALISE: Record<Period, number> = { year: 1, month: 12, week: 52, day: 260, hour: 2080 };
export const annualise = (value: number, period: Period | null | undefined) => Math.round(value * ANNUALISE[period ?? "year"]);

const SYMBOLS: [RegExp, string][] = [
  [/S\$|SGD/i, "SGD"], [/A\$|AUD/i, "AUD"], [/C\$|CAD/i, "CAD"], [/NZ\$|NZD/i, "NZD"], [/HK\$|HKD/i, "HKD"],
  [/£|GBP/i, "GBP"], [/€|EUR/i, "EUR"], [/₹|\bRs\.?\s|\bINR\b|\bLPA\b|\blakh|\blac\b|\bcrore?\b/i, "INR"], [/AED|dirham/i, "AED"], [/CHF/i, "CHF"], [/MYR|\bRM\s?\d/i, "MYR"], [/¥|JPY/i, "JPY"], [/USD|US\$/i, "USD"],
];
const KNOWN_CODES = new Set(COUNTRIES.map((c) => c.currency));

function detectCurrency(text: string, fallback?: string): string | undefined {
  for (const [re, code] of SYMBOLS) if (re.test(text)) return code;
  const code = text.match(/\b([A-Z]{3})\b/g)?.find((c) => KNOWN_CODES.has(c));
  if (code) return code;
  if (/\$/.test(text)) return fallback && ["SGD", "AUD", "CAD", "NZD", "HKD", "USD"].includes(fallback) ? fallback : "USD";
  return fallback;
}

function detectPeriod(text: string): Period | null {
  if (/\b(LPA|per\s*annum|p\.?a\.?|annual(ly)?|per\s*year|\/\s*(yr|year)|yearly|a year)\b/i.test(text)) return "year";
  if (/\b(per\s*month|\/\s*(mo|month)|monthly|pm|a month)\b/i.test(text)) return "month";
  if (/\b(per\s*week|\/\s*(wk|week)|weekly)\b/i.test(text)) return "week";
  if (/\b(per\s*day|\/\s*day|daily|per\s*diem)\b/i.test(text)) return "day";
  if (/\b(per\s*hour|\/\s*(hr|hour)|hourly|an hour)\b/i.test(text)) return "hour";
  return null;
}

/** One number with its suffix: "24", "120k", "1.2m", "8,500", "3 lakh", "1.5 cr". */
const NUM = /(\d[\d,]*(?:\.\d+)?)\s*(k|m|lakhs?|lacs?|lpa|cr|crores?)?/gi;
const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, lpa: 1e5, cr: 1e7, crore: 1e7, crores: 1e7 };

/**
 * Best-effort parse of free-text pay ("SGD 8,000 - 10,000 per month", "24-32 LPA", "$120k-150k", "£50,000").
 * Returns null when no usable number is found. A single number is both min and max. The currency falls back
 * to `defaultCur` (usually the job's country currency) only when the text does not say.
 */
export function parseSalaryText(text: string | null | undefined, defaultCur?: string): Salary | null {
  if (!text) return null;
  const clean = text.replace(/–|—|−/g, "-");
  const found: number[] = [];
  const matches = [...clean.matchAll(NUM)];
  // a trailing suffix applies to a range written like "24-32 LPA" or "120-150k"
  const suffixOfLast = matches.length ? SUFFIX[(matches[matches.length - 1][2] ?? "").toLowerCase()] ?? null : null;
  for (const m of matches) {
    const raw = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(raw)) continue;
    const suf = m[2] ? SUFFIX[m[2].toLowerCase()] : undefined;
    let v = raw * (suf ?? 1);
    if (suf === undefined && suffixOfLast && raw < 1000) v = raw * suffixOfLast;
    found.push(v);
  }
  const nums = found.filter((n) => n > 0);
  if (nums.length === 0) return null;
  const currency = detectCurrency(clean, defaultCur);
  const period = detectPeriod(clean);
  const [a, b] = [nums[0], nums.length > 1 ? nums[1] : nums[0]];
  return { min: Math.min(a, b), max: Math.max(a, b), currency, period };
}

/** Salary as stored on a job: annual min/max with the currency, from either structured numbers or text. */
export function normalizeSalary(s: Salary | null, jobCountry?: string | null): { min: number | null; max: number | null; currency: string | null } {
  if (!s || (s.min === undefined && s.max === undefined)) return { min: null, max: null, currency: null };
  const cur = s.currency ?? defaultCurrency(jobCountry) ?? null;
  return { min: s.min !== undefined ? annualise(s.min, s.period) : null, max: s.max !== undefined ? annualise(s.max, s.period) : null, currency: cur };
}

export type SalaryVerdict = { verdict: "ok" | "below" | "above" | "unknown"; note: string };

/**
 * Compare a job's annual pay with the minimum you want. Only a clear miss is "below": the job must state a pay in the
 * SAME currency, must not be an estimate, and even its top figure must be under your minimum. Anything else is
 * "unknown": the app never converts currencies or guesses, because a wrong rejection loses you a real job.
 */
export function compareSalary(job: { min?: number | null; max?: number | null; currency?: string | null; estimated?: boolean }, pref: { min?: number | null; max?: number | null; currency?: string | null }): SalaryVerdict {
  const top = job.max ?? job.min ?? null;
  if (pref.min == null) return { verdict: "unknown", note: "You have not set a minimum salary for this country" };
  if (top == null) return { verdict: "unknown", note: "The listing does not state a salary" };
  if (!job.currency || !pref.currency) return { verdict: "unknown", note: "The currency is not known, so the pay was not compared" };
  if (job.currency !== pref.currency) return { verdict: "unknown", note: `The listing is in ${job.currency} and your minimum is in ${pref.currency}; no conversion is done` };
  if (job.estimated) return { verdict: "unknown", note: "The listed salary is an estimate by the job site, not the employer" };
  if (top < pref.min) return { verdict: "below", note: `Pay is up to ${fmtMoney(top, job.currency)} a year, below your minimum of ${fmtMoney(pref.min, pref.currency)}` };
  if (pref.max != null && (job.min ?? top) > pref.max) return { verdict: "above", note: `Pay starts at ${fmtMoney(job.min ?? top, job.currency)}, above your stated maximum` };
  return { verdict: "ok", note: `Pay (${fmtMoney(job.min ?? top, job.currency)}${job.max && job.max !== job.min ? ` to ${fmtMoney(job.max, job.currency)}` : ""}) meets your minimum` };
}

export function fmtMoney(n: number, currency: string): string {
  return `${currency} ${Math.round(n).toLocaleString("en-US")}`;
}
