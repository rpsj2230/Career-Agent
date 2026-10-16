import { ADZUNA_COUNTRIES, explainHttpFailure, type IntegrationId } from "@/lib/integrations/catalog";
import { countryQueries, type EffectiveCountry } from "@/lib/country-config";
import { mapAdzuna, mapGreenhouse, mapJSearch, mapLever, mapRemotive } from "./map";
import type { NormalizedJob } from "./normalize";

export type DiscoverySettings = {
  countries: string[];
  roles: string[];
  greenhouse_boards: string[];
  lever_companies: string[];
  max_age_days: number;
  /** When present, each country is searched with its own titles, locations and remote preference. */
  perCountry?: EffectiveCountry[];
};

type Query = { country: string; title: string; location?: string; remote: EffectiveCountry["remote"] };

/** The searches to run: per-country criteria when configured, otherwise every country with every general role. */
export function searchQueries(s: DiscoverySettings): Query[] {
  if (s.perCountry) return s.perCountry.flatMap(countryQueries);
  return s.countries.flatMap((country) => s.roles.map((title) => ({ country, title, remote: "any" as const })));
}

export type IntegrationCreds = {
  adzuna?: { app_id: string; app_key: string };
  jsearch?: { rapidapi_key: string };
};

/** One recorded unit of work: a single integration, country and query. */
export type ScanSpec = { integration: IntegrationId; country?: string; query?: string; fetch: () => Promise<NormalizedJob[]> };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** GET JSON with a timeout; failures become messages that say what to do. */
export function jsonFetcher(fetchImpl: FetchLike = fetch) {
  return async (url: string, init?: RequestInit): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const host = new URL(url).hostname;
    let res: Response;
    try { res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) }); }
    catch (e) { throw new Error(`Could not reach ${host}: ${e instanceof Error ? e.message : String(e)}`); }
    if (!res.ok) throw new Error(explainHttpFailure(res.status, host));
    return res.json();
  };
}

/**
 * Expand settings into the individual scans to run. An integration is included only if it is enabled and has what
 * it needs (credentials, boards). `only` limits the list to one integration (the "Scan now" button).
 */
export function buildScanSpecs(
  s: DiscoverySettings,
  creds: IntegrationCreds,
  enabled: (id: IntegrationId) => boolean,
  opts: { only?: IntegrationId; fetchImpl?: FetchLike } = {},
): ScanSpec[] {
  const get = jsonFetcher(opts.fetchImpl);
  const want = (id: IntegrationId) => enabled(id) && (!opts.only || opts.only === id);
  const specs: ScanSpec[] = [];

  const queries = searchQueries(s);
  const label = (q: Query) => (q.location ? `${q.title} in ${q.location}` : q.title);

  if (want("adzuna") && creds.adzuna) {
    const { app_id, app_key } = creds.adzuna;
    for (const q of queries.filter((q) => ADZUNA_COUNTRIES.includes(q.country))) {
      specs.push({ integration: "adzuna", country: q.country, query: label(q), fetch: async () => {
        const p = new URLSearchParams({ app_id, app_key, results_per_page: "30", what: q.remote === "remote_only" ? `${q.title} remote` : q.title, max_days_old: String(s.max_age_days), "content-type": "application/json" });
        if (q.location) p.set("where", q.location);
        const data = await get(`https://api.adzuna.com/v1/api/jobs/${q.country}/search/1?${p}`);
        return (data.results ?? []).map((r: unknown) => mapAdzuna(r, q.country));
      } });
    }
  }

  if (want("jsearch") && creds.jsearch) {
    const { rapidapi_key } = creds.jsearch;
    for (const q of queries) {
      specs.push({ integration: "jsearch", country: q.country, query: label(q), fetch: async () => {
        const p = new URLSearchParams({ query: label(q), country: q.country, date_posted: s.max_age_days <= 7 ? "week" : "month", num_pages: "1" });
        if (q.remote === "remote_only") p.set("remote_jobs_only", "true");
        const data = await get(`https://jsearch.p.rapidapi.com/search?${p}`, { headers: { "X-RapidAPI-Key": rapidapi_key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" } });
        return (data.data ?? []).map(mapJSearch);
      } });
    }
  }

  if (want("remotive")) {
    // Remotive lists only remote jobs and is not country-specific: one search per title, skipped for on-site-only countries.
    const titles = new Set(queries.filter((q) => q.remote !== "onsite_only").map((q) => q.title));
    for (const role of titles) {
      specs.push({ integration: "remotive", query: role, fetch: async () => {
        const data = await get(`https://remotive.com/api/remote-jobs?${new URLSearchParams({ search: role, limit: "30" })}`);
        return (data.jobs ?? []).map(mapRemotive);
      } });
    }
  }

  if (want("greenhouse")) {
    for (const board of s.greenhouse_boards) {
      specs.push({ integration: "greenhouse", query: board, fetch: async () => {
        const data = await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`);
        return (data.jobs ?? []).map((r: unknown) => mapGreenhouse(r, board));
      } });
    }
  }
  if (want("lever")) {
    for (const company of s.lever_companies) {
      specs.push({ integration: "lever", query: company, fetch: async () => {
        const data = await get(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`);
        return (Array.isArray(data) ? data : []).map((r: unknown) => mapLever(r, company));
      } });
    }
  }
  return specs;
}

/** A minimal real request per integration, so "Test" proves the credentials and the endpoint work. */
export async function testIntegration(id: IntegrationId, creds: IntegrationCreds, s: DiscoverySettings, fetchImpl?: FetchLike): Promise<{ ok: boolean; message: string }> {
  const get = jsonFetcher(fetchImpl);
  try {
    switch (id) {
      case "adzuna": {
        if (!creds.adzuna) return { ok: false, message: "Enter the Application ID and key first." };
        const q = new URLSearchParams({ app_id: creds.adzuna.app_id, app_key: creds.adzuna.app_key, results_per_page: "1", what: "engineer", "content-type": "application/json" });
        const d = await get(`https://api.adzuna.com/v1/api/jobs/gb/search/1?${q}`);
        return { ok: true, message: `Adzuna accepted the credentials (${d.count ?? "some"} UK jobs matched the test query).` };
      }
      case "jsearch": {
        if (!creds.jsearch) return { ok: false, message: "Enter your RapidAPI key first." };
        const d = await get(`https://jsearch.p.rapidapi.com/search?${new URLSearchParams({ query: "engineer in london", num_pages: "1" })}`, { headers: { "X-RapidAPI-Key": creds.jsearch.rapidapi_key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" } });
        return { ok: true, message: `JSearch accepted the key (${(d.data ?? []).length} results for the test query; this used 1 request of your plan).` };
      }
      case "remotive": {
        const d = await get("https://remotive.com/api/remote-jobs?limit=1");
        return { ok: true, message: `Remotive is reachable (${d["job-count"] ?? (d.jobs ?? []).length} job(s) in the test response).` };
      }
      case "greenhouse": {
        const board = s.greenhouse_boards[0];
        if (!board) return { ok: false, message: "No Greenhouse boards are listed yet. Add a board token in Settings > Job discovery." };
        const d = await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`);
        return { ok: true, message: `Board "${board}" is reachable (${(d.jobs ?? []).length} open jobs).` };
      }
      case "lever": {
        const company = s.lever_companies[0];
        if (!company) return { ok: false, message: "No Lever companies are listed yet. Add a company slug in Settings > Job discovery." };
        const d = await get(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json&limit=1`);
        return { ok: true, message: `Company "${company}" is reachable (${Array.isArray(d) ? d.length : 0} posting(s) in the test response).` };
      }
      case "manual": return { ok: true, message: "Manual entry needs nothing to connect." };
      case "mailbox": return { ok: false, message: "This integration is planned and not available yet." };
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
