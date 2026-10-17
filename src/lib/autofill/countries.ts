import { COUNTRIES, countryInfo, defaultCurrency } from "@/lib/countries";
import { defaultPref, dedupeList, WORK_AUTH, type CountryPref } from "@/lib/country-prefs";
import type { MasterProfile } from "@/lib/types";
import { estimatePay } from "./market";
import { inferIndustries, topLocations } from "./industry";

type Auth = (typeof WORK_AUTH)[number]["value"];

const DEMONYMS: Record<string, string[]> = {
  in: ["indian", "india"], sg: ["singaporean", "singapore"], au: ["australian", "australia"], ca: ["canadian", "canada"], us: ["american", "u.s.", "united states", "usa"],
  gb: ["british", "uk citizen", "united kingdom"], ae: ["emirati", "uae"], nz: ["new zealand"], ie: ["irish", "ireland"], de: ["german", "germany"],
};

/** The two-letter code of the country named in a free-text location ("Singapore", "Bengaluru, India"), or null. */
export function countryOfLocation(location: string | null | undefined): string | null {
  const t = (location ?? "").toLowerCase();
  if (!t) return null;
  return COUNTRIES.find((c) => new RegExp(`\\b${c.name.toLowerCase()}\\b`).test(t))?.code ?? null;
}

/** The country your pay figures and visa status are in: the one you chose, else the country of your location. */
export const homeCountry = (p: MasterProfile): string | null => (p.preferences.payCountry?.trim().toLowerCase() || countryOfLocation(p.basics.location) || null);

/**
 * Work authorisation for one country. The default is "I need employer visa sponsorship": it is true for every country where you are
 * not a citizen or permanent resident (including where a work pass is tied to an employer, such as Singapore's Employment Pass),
 * and it is the safe answer on a form. Only your own words that name citizenship or permanent residence of that country change it.
 */
export function inferWorkAuth(p: MasterProfile, country: string): Auth {
  const visa = (p.preferences.visaStatus ?? "").toLowerCase();
  const names = DEMONYMS[country] ?? [(countryInfo(country)?.name ?? "").toLowerCase()].filter(Boolean);
  const mentions = names.some((n) => visa.includes(n));
  if (/\b(citizen|permanent resident|pr)\b/.test(visa) && mentions) return "citizen_pr";
  return "needs_sponsorship";
}

export type Suggestion = { pref: CountryPref; filled: string[] };

/** The fields the auto-fill is allowed to write, and therefore the ones it may later refresh. */
export const AUTO_FIELDS = ["titles", "industries", "locations", "work_authorisation", "salary"] as const;
export type Auto = { titles?: string[]; industries?: string[]; locations?: string[]; work_authorisation?: string | null; salary?: { min: number | null; max: number | null; currency: string | null } };
export const autoOf = (p: CountryPref): Auto => ({ titles: p.titles, industries: p.industries, locations: p.locations, work_authorisation: p.work_authorisation, salary: { min: p.salary_min, max: p.salary_max, currency: p.currency } });
const AUTO_NOTE = "Filled in automatically from your profile";

/** A full proposal for one country from what you have already told the app. */
export function suggestCountry(p: MasterProfile, country: string, today = new Date()): Suggestion {
  const code = country.toLowerCase();
  const base = defaultPref(code, defaultCurrency(code) ?? null);
  const filled: string[] = [];
  const notes: string[] = [];

  const titles = dedupeList(p.preferences.roles.length ? p.preferences.roles : [p.experience[0]?.title ?? p.basics.headline].filter(Boolean) as string[]);
  if (titles.length) { base.titles = titles; filled.push("job titles (from your target roles)"); }

  const industries = inferIndustries(p);
  if (industries.length) { base.industries = industries; filled.push("industries (from your resume)"); }

  const home = homeCountry(p);
  const hubs = topLocations(code, industries);
  const city = (p.basics.location ?? "").split(",")[0].trim();
  const locations = home === code && city && !hubs.some((h) => h.toLowerCase() === city.toLowerCase()) && !/^singapore$/i.test(city) ? [city, ...hubs] : hubs;
  if (locations.length) { base.locations = locations.slice(0, 5); filled.push(`locations (main ${industries[0] ? `${industries[0]} ` : ""}hubs in ${countryInfo(code)?.name ?? code})`); }

  base.work_authorisation = inferWorkAuth(p, code);
  filled.push(base.work_authorisation === "citizen_pr" ? "work authorisation (citizen / permanent resident)" : "work authorisation (needs employer visa sponsorship)");

  const pay = estimatePay(p, code, home, today);
  if (pay) {
    base.salary_min = pay.min; base.salary_max = pay.max; base.currency = pay.currency;
    filled.push(pay.basis === "stated" ? "expected salary (your own figure)" : pay.basis === "scaled" ? "expected salary (market-adjusted from your pay)" : "expected salary (market estimate)");
    notes.push(pay.note);
  }
  base.notes = [`${AUTO_NOTE} on ${today.toISOString().slice(0, 10)}; change anything.`, ...notes].join(" ");
  return { pref: base, filled };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const empty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/**
 * Bring an existing entry up to date with the profile WITHOUT touching what you changed. A field is written only when it is empty,
 * or when it still holds exactly what the auto-fill wrote earlier (`snapshot`; an entry made by an older version of the auto-fill
 * has no snapshot, and counts as untouched while it still carries the auto-fill note). Returns the new entry, what changed, and the
 * snapshot to remember.
 */
export function fillEmpty(existing: CountryPref, s: Suggestion, snapshot?: Auto): { pref: CountryPref; changed: string[]; snapshot: Auto } {
  const next: CountryPref = { ...existing };
  const changed: string[] = [];
  const snap: Auto = { ...(snapshot ?? {}) };
  const legacyAuto = !snapshot && (existing.notes ?? "").startsWith(AUTO_NOTE);
  const mine = autoOf(existing), want = autoOf(s.pref);
  const writable = (k: keyof Auto, isEmpty: boolean) => isEmpty || legacyAuto || (snapshot !== undefined && snapshot[k] !== undefined && same(mine[k], snapshot[k]));
  const label: Record<string, string> = { titles: "job titles", industries: "industries", locations: "locations", work_authorisation: "work authorisation", salary: "expected salary" };

  const take = (k: keyof Auto, apply: () => void, isEmpty: boolean) => {
    if (want[k] === undefined || empty(want[k]) && k !== "salary") return;
    if (same(mine[k], want[k])) { (snap as Record<string, unknown>)[k] = want[k]; return; }
    if (!writable(k, isEmpty)) return;
    apply(); changed.push(label[k]); (snap as Record<string, unknown>)[k] = want[k];
  };
  take("titles", () => { next.titles = s.pref.titles; }, existing.titles.length === 0);
  take("industries", () => { next.industries = s.pref.industries; }, existing.industries.length === 0);
  take("locations", () => { next.locations = s.pref.locations; }, existing.locations.length === 0);
  take("work_authorisation", () => { next.work_authorisation = s.pref.work_authorisation; }, !existing.work_authorisation);
  if (s.pref.salary_min !== null) take("salary", () => { next.salary_min = s.pref.salary_min; next.salary_max = s.pref.salary_max; next.currency = s.pref.currency; }, existing.salary_min === null && existing.salary_max === null);
  if (!existing.currency && s.pref.currency) next.currency = s.pref.currency;
  if (changed.length && (!existing.notes || legacyAuto || (existing.notes ?? "").startsWith(AUTO_NOTE))) next.notes = s.pref.notes;
  return { pref: next, changed, snapshot: snap };
}
