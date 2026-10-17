import { countryInfo } from "@/lib/countries";
import type { MasterProfile } from "@/lib/types";
import { fromUsd, parseAmount, roundMoney, toUsd, RATES_AS_OF, type Amount } from "./money";

/**
 * Expected-pay estimation. A salary typed for one country is NOT copied to another (a plain currency conversion of a Singapore salary
 * would price an Indian role at three times its market). Instead the figure is
 *   1. read from your profile (expected pay; or current pay plus a typical step-up),
 *   2. re-scaled to the target country's wage level, blended with the plain conversion because experience abroad does earn a premium,
 *   3. and checked against a benchmark for your seniority in that country, pulling an out-of-market figure back into a credible band.
 * The tables below are INDICATIVE (rounded, from general public wage statistics), not live data; every estimate says so.
 */

/** Typical professional pay level by country, United States = 100. */
export const WAGE_INDEX: Record<string, number> = {
  us: 100, ch: 105, lu: 90, sg: 78, au: 75, ca: 70, ie: 70, gb: 68, de: 68, nl: 66, dk: 70, no: 70, il: 70, hk: 70, ae: 62, nz: 62, be: 62, at: 62, qa: 65, kw: 60, se: 60,
  fr: 58, fi: 58, jp: 55, kr: 55, sa: 55, bh: 52, om: 50, it: 48, es: 45, tw: 40, pt: 35, pl: 35, cn: 35, cz: 33, gr: 33, in: 28, mx: 28, cl: 28, hu: 28, my: 25, za: 25,
  br: 25, ro: 25, th: 22, tr: 22, ar: 22, co: 20, pe: 20, id: 18, ph: 17, vn: 17, lk: 15, ng: 15, ke: 15, bd: 14, pk: 14, eg: 12, np: 12,
};

export type Level = "junior" | "mid" | "senior" | "lead";
/** Typical yearly pay in US dollars for a professional/managerial role of this level in the United States. */
export const LEVEL_USD: Record<Level, number> = { junior: 70_000, mid: 100_000, senior: 140_000, lead: 185_000 };
const LEVEL_LABEL: Record<Level, string> = { junior: "early-career", mid: "mid-level", senior: "senior", lead: "lead / head" };

export function yearsOfExperience(p: MasterProfile, now = new Date()): number | null {
  const years = p.experience.flatMap((e) => [e.start, e.end]).flatMap((s) => [...(s ?? "").matchAll(/\b(19[89]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1])));
  if (!years.length) return null;
  return Math.max(0, now.getFullYear() - Math.min(...years));
}

/** Seniority from years of experience, raised by the titles you have held (Head/Director/VP/Lead). */
export function levelOf(p: MasterProfile, now = new Date()): Level {
  const years = yearsOfExperience(p, now);
  let level: Level = years === null ? "mid" : years < 3 ? "junior" : years < 7 ? "mid" : years < 12 ? "senior" : "lead";
  const titles = `${p.basics.headline} ${p.experience.slice(0, 2).map((e) => e.title).join(" ")}`.toLowerCase();
  const rank: Level[] = ["junior", "mid", "senior", "lead"];
  const atLeast = (l: Level) => { if (rank.indexOf(level) < rank.indexOf(l)) level = l; };
  if (/\b(director|head of|vp\b|vice president|chief|cxo|general manager|principal)\b/.test(titles)) atLeast("lead");
  else if (/\b(lead|leader|manager|senior|sr\.?)\b/.test(titles)) atLeast("senior");
  return level;
}

export type PayEstimate = { min: number; max: number | null; currency: string; basis: "stated" | "scaled" | "market"; note: string };

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const idx = (c: string) => WAGE_INDEX[c.toLowerCase()];

/** Benchmark for your level in a country, in that country's currency (rounded). Null when the country or currency is unknown. */
export function benchmark(country: string, level: Level): { local: number; usd: number; currency: string } | null {
  const currency = countryInfo(country)?.currency, i = idx(country);
  if (!currency || !i) return null;
  const usd = (LEVEL_USD[level] * i) / 100;
  const local = fromUsd(usd, currency);
  return local === null ? null : { local: roundMoney(local), usd, currency };
}

/**
 * The expected-pay range for one country. `home` is the country your own figures are in. Returns null only when nothing
 * can be said (unknown country, or no pay figure and no benchmark).
 */
export function estimatePay(p: MasterProfile, country: string, home: string | null, now = new Date()): PayEstimate | null {
  const c = country.toLowerCase();
  const target = countryInfo(c);
  if (!target) return null;
  const level = levelOf(p, now);
  const bench = benchmark(c, level);
  const homeCurrency = home ? countryInfo(home)?.currency ?? null : null;

  let anchor: Amount | null = parseAmount(p.preferences.expectedCtc, homeCurrency);
  let anchorKind = "expected pay";
  if (!anchor) {
    const cur = parseAmount(p.preferences.currentCtc, homeCurrency);
    if (cur) { anchor = { ...cur, min: cur.min * 1.15, max: cur.max === null ? null : cur.max * 1.15 }; anchorKind = "current pay plus a typical 15% step-up"; }
  }
  const asOf = `Indicative figures (${RATES_AS_OF}), not live market data: check before relying on them.`;

  // 1. no pay figure at all: the benchmark for your level in this country
  if (!anchor) {
    if (!bench) return null;
    return { min: roundMoney(bench.local * 0.92), max: roundMoney(bench.local * 1.15), currency: bench.currency, basis: "market",
      note: `Salary is a market estimate for ${LEVEL_LABEL[level]} roles in ${target.name} (about ${bench.currency} ${fmt(bench.local)}); add your expected pay on the Profile page for a personal figure. ${asOf}` };
  }

  // 2. your own country: your figure stands, and is only compared with the market
  if (home && c === home.toLowerCase() && anchor.currency === target.currency) {
    const min = roundMoney(anchor.min), max = anchor.max !== null ? roundMoney(anchor.max) : roundMoney(anchor.min * 1.15);
    let verdict = "";
    if (bench) { const r = anchor.min / bench.local; verdict = r > 1.35 ? ` It is above the typical ${fmt(bench.local)} for ${LEVEL_LABEL[level]} roles here, so fewer listings may qualify.` : r < 0.75 ? ` It is below the typical ${fmt(bench.local)} for ${LEVEL_LABEL[level]} roles here; you may be underpricing yourself.` : ` It is in line with the market for ${LEVEL_LABEL[level]} roles here (about ${fmt(bench.local)}).`; }
    return { min, max, currency: target.currency, basis: "stated", note: `Salary range is your own ${anchorKind} (${anchor.currency} ${fmt(anchor.min)}${anchor.max !== null ? `-${fmt(anchor.max)}` : ""}).${verdict} ${asOf}` };
  }

  // 3. another country: re-scale to its wage level, blend with the plain conversion, then check against the benchmark
  const anchorUsd = toUsd(anchor.min, anchor.currency);
  const maxUsd = anchor.max === null ? null : toUsd(anchor.max, anchor.currency);
  if (anchorUsd === null) return null;
  const homeIdx = (home && idx(home)) || idx(anchor.currency === "SGD" ? "sg" : anchor.currency === "INR" ? "in" : "us") || 100;
  const tIdx = idx(c);
  if (!tIdx) return null;
  const scale = (usd: number) => 0.7 * (usd * tIdx / homeIdx) + 0.3 * usd; // experience abroad earns a premium over the local scale
  let pointUsd = scale(anchorUsd);
  let adjusted = "";
  if (bench) {
    const lo = bench.usd * 0.8, hi = bench.usd * 1.35;
    if (pointUsd > hi) { pointUsd = hi; adjusted = ` Pulled down to the ${target.name} market ceiling for ${LEVEL_LABEL[level]} roles.`; }
    else if (pointUsd < lo) { pointUsd = lo; adjusted = ` Raised to the ${target.name} market floor for ${LEVEL_LABEL[level]} roles.`; }
  }
  const minLocal = fromUsd(pointUsd * (maxUsd === null ? 0.92 : 1), target.currency);
  const maxLocal = fromUsd(maxUsd === null ? pointUsd * 1.15 : Math.max(pointUsd, scale(maxUsd)), target.currency);
  if (minLocal === null || maxLocal === null) return null;
  return {
    min: roundMoney(minLocal), max: roundMoney(Math.max(maxLocal, minLocal)), currency: target.currency, basis: "scaled",
    note: `Salary is estimated from your ${anchorKind} (${anchor.currency} ${fmt(anchor.min)}), re-scaled to ${target.name}'s wage level (${tIdx} vs ${homeIdx}, United States = 100) and checked against ${LEVEL_LABEL[level]} roles there (about ${bench ? `${bench.currency} ${fmt(bench.local)}` : "n/a"}).${adjusted} ${asOf}`,
  };
}
