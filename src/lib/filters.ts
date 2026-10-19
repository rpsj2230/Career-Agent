import { COUNTRY_NAME_MAP } from "@/lib/countries";
/** Query-string filters for the Jobs and Applications lists. Everything is validated; unknown values are dropped. */

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim();

/** Characters that would change the meaning of a PostgREST filter string are removed from free text. */
export const safeSearch = (q: string | undefined) => (q ?? "").replace(/[,()*%_\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

/** Human labels for the status model used on every screen. */
export const APP_STATUS_LABEL: Record<string, string> = {
  prepared: "Pending approval", approved: "Approved, sending soon", submitting: "Sending now", submitted: "Applied",
  assisted_pending: "Waiting for assistant / you", needs_input: "Needs your input", failed: "Failed",
};

export const COUNTRY_NAMES: Record<string, string> = {
  in: "India", sg: "Singapore", ae: "UAE", gb: "United Kingdom", us: "United States", au: "Australia", ca: "Canada", de: "Germany", nl: "Netherlands",
  ie: "Ireland", fr: "France", es: "Spain", it: "Italy", nz: "New Zealand", za: "South Africa", pl: "Poland", br: "Brazil", mx: "Mexico", ch: "Switzerland", at: "Austria", be: "Belgium",
};
export const countryLabel = (c: string | null | undefined) => (c ? COUNTRY_NAMES[c.toLowerCase()] ?? COUNTRY_NAME_MAP[c.toLowerCase()] ?? c.toUpperCase() : "Unknown");

/** A single optional two-letter country from the query string; anything else is ignored. */
export function parseCountry(sp: SP): string | undefined {
  const c = one(sp.country)?.toLowerCase();
  return c && /^[a-z]{2}$/.test(c) ? c : undefined;
}
