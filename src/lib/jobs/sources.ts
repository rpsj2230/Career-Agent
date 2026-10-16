import { ADZUNA_COUNTRIES, explainHttpFailure, type IntegrationId } from "@/lib/integrations/catalog";
import { countryQueries, type EffectiveCountry } from "@/lib/country-config";
import { imapSource, scanMailbox, type MailboxConfig, type MailSource } from "./mailbox";
import { mapAdzuna, mapArbeitnow, mapGreenhouse, mapJobicy, mapJSearch, mapLever, mapRemoteOk, mapRemotive } from "./map";
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
  mailbox?: MailboxConfig;
};

/** Replaceable pieces, so scans can be tested without the network. */
export type ScanDeps = { fetchImpl?: FetchLike; mailSource?: (cfg: MailboxConfig) => MailSource };

/** One recorded unit of work: a single integration, country and query. */
export type ScanSpec = { integration: IntegrationId; country?: string; query?: string; fetch: () => Promise<NormalizedJob[]> };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Does a job title fit one of the wanted titles? Every meaningful word of a wanted title must appear in the job title
 * ("Product Manager" matches "Senior Product Manager, Growth" but not "Program Manager"). With no wanted titles, everything matches.
 */
export function titleMatches(jobTitle: string, wanted: string[]): boolean {
  if (wanted.length === 0) return true;
  const hay = jobTitle.toLowerCase().replace(/[^a-z0-9+#]+/g, " ");
  return wanted.some((w) => {
    const words = w.toLowerCase().split(/[^a-z0-9+#]+/).filter((x) => x.length > 1);
    return words.length > 0 && words.every((x) => hay.split(" ").includes(x) || hay.includes(x));
  });
}

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
  opts: { only?: IntegrationId; fetchImpl?: FetchLike; mailSource?: (cfg: MailboxConfig) => MailSource } = {},
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

  // Feeds without a search API: fetch the whole feed once, keep the jobs that match one of the wanted titles.
  const titles = [...new Set(queries.map((q) => q.title))];
  const wantsOnsite = queries.some((q) => q.remote !== "remote_only");
  const matchesTitle = (j: NormalizedJob) => titleMatches(j.title, titles);
  if (want("arbeitnow") && wantsOnsite) {
    specs.push({ integration: "arbeitnow", query: "Europe feed", fetch: async () => ((await get("https://www.arbeitnow.com/api/job-board-api")).data ?? []).map(mapArbeitnow).filter(matchesTitle) });
  }
  if (want("remoteok")) {
    specs.push({ integration: "remoteok", query: "remote feed", fetch: async () => {
      const data = await get("https://remoteok.com/api", { headers: { "User-Agent": "career-agent/1.0 (personal job search)" } });
      // the first element is a legal notice, not a job
      return (Array.isArray(data) ? data : []).filter((r: any) => r && r.id && (r.position || r.title)).map(mapRemoteOk).filter(matchesTitle); // eslint-disable-line @typescript-eslint/no-explicit-any
    } });
  }
  if (want("jobicy")) {
    specs.push({ integration: "jobicy", query: "remote feed", fetch: async () => ((await get("https://jobicy.com/api/v2/remote-jobs?count=50")).jobs ?? []).map(mapJobicy).filter(matchesTitle) });
  }

  if (want("mailbox") && creds.mailbox) {
    const cfg = creds.mailbox;
    specs.push({ integration: "mailbox", query: `${cfg.folder || "INBOX"} (alert emails)`, fetch: async () => (await scanMailbox((opts.mailSource ?? imapSource)(cfg), { sinceDays: Math.min(s.max_age_days, 30) })).jobs });
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
export async function testIntegration(id: IntegrationId, creds: IntegrationCreds, s: DiscoverySettings, fetchImpl?: FetchLike, deps: Pick<ScanDeps, "mailSource"> = {}): Promise<{ ok: boolean; message: string }> {
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
      case "arbeitnow": {
        const d = await get("https://www.arbeitnow.com/api/job-board-api");
        return { ok: true, message: `Arbeitnow is reachable (${(d.data ?? []).length} jobs in the current feed).` };
      }
      case "remoteok": {
        const d = await get("https://remoteok.com/api", { headers: { "User-Agent": "career-agent/1.0 (personal job search)" } });
        return { ok: true, message: `Remote OK is reachable (${Math.max(0, (Array.isArray(d) ? d.length : 0) - 1)} jobs in the current feed).` };
      }
      case "jobicy": {
        const d = await get("https://jobicy.com/api/v2/remote-jobs?count=5");
        return { ok: true, message: `Jobicy is reachable (${(d.jobs ?? []).length} jobs in the test response).` };
      }
      case "manual": return { ok: true, message: "Manual entry needs nothing to connect." };
      case "mailbox": {
        if (!creds.mailbox) return { ok: false, message: "Enter the IMAP server, your address and an app password first." };
        const r = await scanMailbox((deps.mailSource ?? imapSource)(creds.mailbox), { sinceDays: 30 });
        const portals = Object.entries(r.byPortal).map(([p, n]) => `${n} from ${p}`).join(", ");
        if (r.emails === 0) return { ok: true, message: `Connected to ${creds.mailbox.host} as ${creds.mailbox.user}, but there are no LinkedIn, Indeed, Glassdoor or Naukri alert emails in ${creds.mailbox.folder || "INBOX"} from the last 30 days. Turn on job alerts on those sites (or point the folder at the label that holds them).` };
        if (r.jobs.length === 0) return { ok: false, message: `Connected and found ${r.emails} alert email(s), but no jobs could be read from them. The portal's email layout may have changed.` };
        return { ok: true, message: `Connected. ${r.emails} alert email(s) in the last 30 days contain ${r.jobs.length} job link(s) (${portals}).` };
      }
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
