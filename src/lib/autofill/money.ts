/**
 * Reading a pay figure the way people write it ("32 LPA", "S$180k", "SGD 15,000 per month", "$150-170k") and expressing it in
 * another currency. Exchange rates are APPROXIMATE and fixed (units per 1 USD); they are only used to propose starting figures that
 * are always shown as estimates, never to state a fact.
 */
export type Amount = { min: number; max: number | null; currency: string };

export const RATES_AS_OF = "2026-10";
const PER_USD: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, CHF: 0.88, INR: 84, SGD: 1.34, AUD: 1.52, CAD: 1.37, NZD: 1.66, AED: 3.6725, SAR: 3.75, QAR: 3.64, KWD: 0.307, BHD: 0.376, OMR: 0.385,
  HKD: 7.8, MYR: 4.4, JPY: 150, KRW: 1350, TWD: 32, CNY: 7.2, THB: 35, IDR: 15800, PHP: 57, VND: 25000, PLN: 4.0, SEK: 10.5, DKK: 6.9, NOK: 10.8, CZK: 23, HUF: 360, RON: 4.6,
  ZAR: 18.5, BRL: 5.4, MXN: 18.5, TRY: 34, ILS: 3.7, LKR: 300, BDT: 120, PKR: 280, NPR: 134, NGN: 1500, KES: 129, EGP: 49, ARS: 950, CLP: 950, COP: 4100, PEN: 3.75,
};
export const knownCurrency = (c: string | null | undefined): c is string => !!c && c in PER_USD;

const DOLLAR_FAMILY = new Set(["USD", "SGD", "AUD", "CAD", "NZD", "HKD"]);
const CODES = Object.keys(PER_USD);

function detectCurrency(text: string, fallback: string | null): string | null {
  const t = text;
  const code = CODES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(t));
  if (code) return code.toUpperCase();
  if (/\bS\$|\bSG\$/i.test(t)) return "SGD";
  if (/\bA\$|\bAU\$|\bAUD/i.test(t)) return "AUD";
  if (/\bC\$|\bCA\$|\bCAD/i.test(t)) return "CAD";
  if (/\bNZ\$/i.test(t)) return "NZD";
  if (/\bUS\$/i.test(t)) return "USD";
  if (/₹|\brs\.?\b|\blpa\b|\blakhs?\b|\blacs?\b|\bcrores?\b/i.test(t)) return "INR";
  if (/£/.test(t)) return "GBP";
  if (/€/.test(t)) return "EUR";
  if (/\bdh\b/i.test(t)) return "AED";
  if (/\$/.test(t)) return fallback && DOLLAR_FAMILY.has(fallback) ? fallback : "USD";
  return fallback;
}

const SUFFIX: [RegExp, number][] = [[/^(lpa|lakhs?|lacs?|l)$/i, 1e5], [/^(crores?|cr)$/i, 1e7], [/^k$/i, 1e3], [/^(m|mn|million)$/i, 1e6]];
const suffixValue = (s: string | undefined) => (s ? SUFFIX.find(([re]) => re.test(s))?.[1] ?? null : null);

/** Annual figure(s) from free text, or null when no pay can be read. `fallbackCurrency` is used when the text names none. */
export function parseAmount(text: string | null | undefined, fallbackCurrency: string | null = null): Amount | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const currency = detectCurrency(raw, fallbackCurrency);
  if (!currency || !(currency in PER_USD)) return null;
  const monthly = /\b(per\s*month|a\s*month|monthly|\/\s*(mo|month)|pm)\b/i.test(raw);
  const tokens = [...raw.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|crores?|cr|k|mn|million|m|l)?\b/gi)]
    .map((m) => ({ n: Number(m[1].replace(/,/g, "")), s: suffixValue(m[2]) }))
    .filter((t) => Number.isFinite(t.n) && t.n > 0);
  if (tokens.length === 0) return null;
  // "150-170k": the first number shares the last number's suffix
  const shared = [...tokens].reverse().find((t) => t.s)?.s ?? null;
  let vals = tokens.slice(0, 2).map((t) => t.n * (t.s ?? shared ?? 1));
  // a bare small number in rupee context is lakhs ("32" means 32 LPA)
  if (currency === "INR" && vals.every((v) => v < 1000)) vals = vals.map((v) => v * 1e5);
  if (vals.every((v) => v < 1000) && currency !== "INR") return null; // too small to be an annual figure
  if (monthly) vals = vals.map((v) => v * 12);
  const [a, b] = vals;
  return { min: Math.min(a, b ?? a), max: b !== undefined && b !== a ? Math.max(a, b) : null, currency };
}

const roundNice = (n: number) => {
  const step = n < 1e5 ? 1000 : n < 1e6 ? 5000 : n < 1e7 ? 50000 : 500000;
  return Math.round(n / step) * step;
};

/** Convert at the approximate fixed rates and round to a tidy figure. Null when either currency is unknown. */
export function convertAmount(a: Amount, to: string): Amount | null {
  if (!knownCurrency(a.currency) || !knownCurrency(to)) return null;
  if (a.currency === to) return a;
  const f = (n: number) => roundNice((n / PER_USD[a.currency]) * PER_USD[to]);
  return { min: f(a.min), max: a.max === null ? null : f(a.max), currency: to };
}

/** Value in US dollars at the approximate rates, or null for an unknown currency. */
export const toUsd = (n: number, currency: string): number | null => (knownCurrency(currency) ? n / PER_USD[currency] : null);
/** US dollars to another currency (unrounded), or null for an unknown currency. */
export const fromUsd = (usd: number, currency: string): number | null => (knownCurrency(currency) ? usd * PER_USD[currency] : null);
export const roundMoney = roundNice;
