import { COUNTRY_NAME_MAP } from "@/lib/countries";
/** Query-string filters for the Jobs and Applications lists. Everything is validated; unknown values are dropped. */

export const JOB_VIEWS = {
  queue: { label: "Review queue", statuses: ["queued", "prepared", "saved"] as string[] },
  new: { label: "Not scored yet", statuses: ["new"] },
  skipped: { label: "Rejected (with reasons)", statuses: ["skipped"] },
  applied: { label: "Applied", statuses: ["applied"] },
  all: { label: "All jobs", statuses: null as string[] | null },
} as const;
export type JobView = keyof typeof JOB_VIEWS;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim();

/** Characters that would change the meaning of a PostgREST filter string are removed from free text. */
export const safeSearch = (q: string | undefined) => (q ?? "").replace(/[,()*%_\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

export type JobFilters = { view: JobView; portal?: string; country?: string; q?: string };

export function parseJobFilters(sp: SP): JobFilters {
  const view = one(sp.view) as JobView | undefined;
  const portal = one(sp.portal)?.toLowerCase();
  const country = one(sp.country)?.toLowerCase();
  const q = safeSearch(one(sp.q));
  return {
    view: view && view in JOB_VIEWS ? view : "queue",
    portal: portal && /^[a-z0-9]{1,40}$/.test(portal) ? portal : undefined,
    country: country && /^[a-z]{2}$/.test(country) ? country : undefined,
    q: q || undefined,
  };
}

export const APP_STATUSES = {
  all: { label: "All statuses", statuses: null as string[] | null },
  pending: { label: "Pending approval", statuses: ["prepared"] },
  manual: { label: "Requires manual action", statuses: ["assisted_pending", "needs_input"] },
  submitted: { label: "Submitted", statuses: ["submitted"] },
  failed: { label: "Failed", statuses: ["failed"] },
  inprogress: { label: "In progress", statuses: ["approved", "submitting"] },
} as const;
export type AppStatusView = keyof typeof APP_STATUSES;
export type AppFilters = { status: AppStatusView; portal?: string; country?: string; q?: string };

export function parseAppFilters(sp: SP): AppFilters {
  const j = parseJobFilters(sp);
  const status = one(sp.status) as AppStatusView | undefined;
  return { status: status && status in APP_STATUSES ? status : "all", portal: j.portal, country: j.country, q: j.q };
}

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
