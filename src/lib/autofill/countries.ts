import { COUNTRIES, countryInfo, defaultCurrency } from "@/lib/countries";
import { defaultPref, dedupeList, WORK_AUTH, type CountryPref } from "@/lib/country-prefs";
import type { MasterProfile } from "@/lib/types";
import { convertAmount, parseAmount, RATES_AS_OF } from "./money";

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
 * Work authorisation for one country, only where your own words make it certain:
 * - "citizen"/"permanent resident"/"PR" naming that country (or its nationality), or
 * - a visa, pass or permit while it is your home country (where you live and are paid).
 * Anywhere else it is left blank on purpose: a wrong answer here is submitted on forms, so you choose it once.
 */
export function inferWorkAuth(p: MasterProfile, country: string): Auth | null {
  const visa = (p.preferences.visaStatus ?? "").toLowerCase();
  if (!visa.trim()) return null;
  const names = DEMONYMS[country] ?? [(countryInfo(country)?.name ?? "").toLowerCase()].filter(Boolean);
  const mentions = names.some((n) => visa.includes(n));
  if (/\b(citizen|permanent resident|pr)\b/.test(visa) && mentions) return "citizen_pr";
  if (country === homeCountry(p) && /\b(visa|pass|permit|ep|s pass|h-?1b|work authori[sz]ation|skilled)\b/.test(visa)) return "has_work_visa";
  if (/\bneed|require|sponsor/.test(visa) && mentions) return "needs_sponsorship";
  return null;
}

export type Suggestion = { pref: CountryPref; filled: string[] };

/** A full proposal for one country from what you have already told the app. Fields it cannot know stay empty. */
export function suggestCountry(p: MasterProfile, country: string, today = new Date()): Suggestion {
  const code = country.toLowerCase();
  const base = defaultPref(code, defaultCurrency(code) ?? null);
  const filled: string[] = [];
  const notes: string[] = [];

  const titles = dedupeList(p.preferences.roles.length ? p.preferences.roles : [p.experience[0]?.title ?? p.basics.headline].filter(Boolean) as string[]);
  if (titles.length) { base.titles = titles; filled.push("job titles (from your target roles)"); }

  const home = homeCountry(p);
  const city = (p.basics.location ?? "").split(",")[0].trim();
  if (home === code && city) { base.locations = [city]; filled.push("location (from your profile)"); }

  const auth = inferWorkAuth(p, code);
  if (auth) { base.work_authorisation = auth; filled.push("work authorisation (from your visa status)"); }

  const homeCurrency = home ? defaultCurrency(home) ?? null : null;
  const expected = parseAmount(p.preferences.expectedCtc, homeCurrency);
  if (expected && base.currency) {
    const converted = expected.currency === base.currency ? expected : convertAmount(expected, base.currency);
    if (converted) {
      base.salary_min = converted.min; base.salary_max = converted.max;
      filled.push(expected.currency === base.currency ? "expected salary (your own figure)" : `expected salary (estimated from ${p.preferences.expectedCtc})`);
      if (expected.currency !== base.currency) notes.push(`Salary is an estimate converted from your expected pay (${p.preferences.expectedCtc}) at approximate ${RATES_AS_OF} exchange rates, not a market figure for ${countryInfo(code)?.name ?? code}. Check it before relying on it.`);
    }
  }
  if (filled.length) base.notes = [`Filled in automatically from your profile on ${today.toISOString().slice(0, 10)}; change anything.`, ...notes].join(" ");
  return { pref: base, filled };
}

/** Fill only the empty fields of an existing entry; anything you already set is kept exactly as it is. */
export function fillEmpty(existing: CountryPref, s: Suggestion): { pref: CountryPref; changed: string[] } {
  const next: CountryPref = { ...existing };
  const changed: string[] = [];
  const set = <K extends keyof CountryPref>(k: K, v: CountryPref[K], label: string) => { next[k] = v; changed.push(label); };
  const p = s.pref;
  if (existing.titles.length === 0 && p.titles.length) set("titles", p.titles, "job titles");
  if (existing.locations.length === 0 && p.locations.length) set("locations", p.locations, "locations");
  if (!existing.work_authorisation && p.work_authorisation) set("work_authorisation", p.work_authorisation, "work authorisation");
  if (existing.salary_min === null && existing.salary_max === null && p.salary_min !== null) {
    next.salary_min = p.salary_min; next.salary_max = p.salary_max; next.currency = p.currency; changed.push("expected salary");
  }
  if (!existing.currency && p.currency) next.currency = p.currency;
  if (changed.length && !existing.notes) next.notes = p.notes;
  return { pref: next, changed };
}
