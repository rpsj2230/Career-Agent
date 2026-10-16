import type { CountryPref } from "./country-prefs";
import { needsSponsorship } from "./country-prefs";
import { dedupeList } from "./country-prefs";

/** What discovery and matching use for one country. */
export type EffectiveCountry = {
  country: string;
  titles: string[];
  industries: string[];
  locations: string[];
  remote: CountryPref["remote"];
  salary: { min: number | null; max: number | null; currency: string | null };
  workAuthorisation: string | null;
  needsSponsorship: boolean | null;
  notes: string | null;
  /** true when this country came from the general Settings rather than from a Countries entry */
  fallback: boolean;
};

const blank = (country: string, titles: string[]): EffectiveCountry => ({
  country, titles, industries: [], locations: [], remote: "any", salary: { min: null, max: null, currency: null },
  workAuthorisation: null, needsSponsorship: null, notes: null, fallback: true,
});

/**
 * Decide the countries to search and the criteria for each.
 * - If any country is configured on the Countries page, ONLY the enabled configured ones are used.
 * - A configured country with no titles uses your general roles, so an empty field never means "search nothing".
 * - With nothing configured, the general countries and roles are used as before.
 */
export function mergeCountryConfigs(prefs: CountryPref[], globalRoles: string[], fallbackCountries: string[]): EffectiveCountry[] {
  const roles = dedupeList(globalRoles);
  if (prefs.length > 0) {
    return prefs.filter((p) => p.enabled).map((p) => ({
      country: p.country,
      titles: p.titles.length ? p.titles : roles,
      industries: p.industries, locations: p.locations, remote: p.remote,
      salary: { min: p.salary_min, max: p.salary_max, currency: p.currency },
      workAuthorisation: p.work_authorisation, needsSponsorship: needsSponsorship(p.work_authorisation), notes: p.notes, fallback: false,
    }));
  }
  return dedupeList(fallbackCountries.map((c) => c.toLowerCase())).map((c) => blank(c, roles));
}

/** The individual searches a country produces: each title in each location (or without a location). */
export function countryQueries(c: EffectiveCountry): { country: string; title: string; location?: string; remote: EffectiveCountry["remote"] }[] {
  const locations = c.locations.length ? c.locations : [undefined];
  return c.titles.flatMap((title) => locations.map((location) => ({ country: c.country, title, location, remote: c.remote })));
}

export const countryByCode = (list: EffectiveCountry[], code: string | null | undefined) => list.find((c) => c.country === code?.toLowerCase());
