import { ADZUNA_COUNTRIES, explainHttpFailure, type IntegrationId } from "@/lib/integrations/catalog";
import { countryQueries, type EffectiveCountry } from "@/lib/country-config";
import { ApifyActor, mapApifyItem, runActor, templateVars, type ApifyFetch } from "./apify";
import { imapSource, scanMailbox, type MailboxConfig, type MailSource } from "./mailbox";
import { mapAshby, mapRecruitee, mapWorkable, mapMcf, mapAdzuna, mapArbeitnow, mapGreenhouse, mapJobicy, mapJSearch, mapLever, mapRemoteOk, mapRemotive } from "./map";
import type { NormalizedJob } from "./normalize";

export type DiscoverySettings = {
  countries: string[];
  roles: string[];
  greenhouse_boards: string[];
  lever_companies: string[];
  ashby_orgs?: string[];
  workable_accounts?: string[];
  recruitee_companies?: string[];
  /** companies discovered by the agent (jobs/ats.ts); read with the same title filter as feeds */
  watch?: Partial<Record<"greenhouse" | "lever" | "ashby" | "workable" | "recruitee", string[]>>;
  max_age_days: number;
  /** When present, each country is searched with its own titles, locations and remote preference. */
  perCountry?: EffectiveCountry[];
  /** hosted scrapers to run (Settings: Portals > Hosted scrapers) */
  apify_actors?: ApifyActor[];
  /** when this search last succeeded (a search only needs jobs newer than that); absent = first run, use the full window */
  since?: (integration: IntegrationId, country: string | undefined, query: string | undefined) => Date | null;
  /** searches that ran within this many hours are skipped by the caller (see discover.ts) */
  min_rescan_hours?: number;
  /** monthly job budget for hosted scrapers (see apify-usage.ts); absent = unlimited */
  apify_budget?: { remaining: () => Promise<number>; record: (n: number) => Promise<void> };
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
  apify?: { token: string };
  mailbox?: MailboxConfig;
};

/** Replaceable pieces, so scans can be tested without the network. */
export type ScanDeps = { fetchImpl?: FetchLike; mailSource?: (cfg: MailboxConfig) => MailSource; apifyFetch?: ApifyFetch };

/** One recorded unit of work: a single integration, country and query. */
export type ScanSpec = { integration: IntegrationId; country?: string; query?: string; windowDays?: number; fetch: () => Promise<NormalizedJob[]> };

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
/** JSearch moved its search from /search to /search-v2; ask the new one first and fall back to the old one if it is gone. */
export async function jsearchSearch(get: ReturnType<typeof jsonFetcher>, key: string, params: URLSearchParams): Promise<unknown[]> {
  const init = { headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" } };
  let data;
  try { data = await get(`https://jsearch.p.rapidapi.com/search-v2?${params}`, init); }
  catch (e) {
    if (!/HTTP 404/.test(e instanceof Error ? e.message : "")) throw e;
    data = await get(`https://jsearch.p.rapidapi.com/search?${params}`, init);
  }
  const inner = data?.data;
  const list = [inner, inner?.jobs, inner?.results, data?.jobs, data?.results].find(Array.isArray);
  return list ?? [];
}

export function jsonFetcher(fetchImpl: FetchLike = fetch) {
  return async (url: string, init?: RequestInit): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const host = new URL(url).hostname;
    let res: Response;
    try { res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) }); }
    catch (e) { throw new Error(`Could not reach ${host}: ${e instanceof Error ? e.message : String(e)}`); }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let said = body.trim();
      try { const j = JSON.parse(body); said = typeof j === "object" && j ? String(j.message ?? j.error ?? j.detail ?? "") : String(j); } catch { /* not JSON: use the text */ }
      if (/^[[{]/.test(said)) said = ""; // raw JSON with no message is noise
      throw new Error(explainHttpFailure(res.status, host, said.replace(/\s+/g, " ").slice(0, 160) || undefined));
    }
    return res.json();
  };
}

/**
 * How many days back one search needs to look: since its last successful run (plus a day of overlap for time zones and late
 * postings), never more than the configured maximum age. The first run of a search looks back the full window.
 */
export function windowDays(s: DiscoverySettings, spec: { integration: IntegrationId; country?: string; query?: string }, now = Date.now()): number {
  const since = s.since?.(spec.integration, spec.country, spec.query);
  if (!since) return s.max_age_days;
  return Math.max(1, Math.min(s.max_age_days, Math.ceil((now - since.getTime()) / 86_400_000) + 1));
}

/**
 * Expand settings into the individual scans to run. An integration is included only if it is enabled and has what
 * it needs (credentials, boards). `only` limits the list to one integration (the "Scan now" button).
 */
export function buildScanSpecs(
  s: DiscoverySettings,
  creds: IntegrationCreds,
  enabled: (id: IntegrationId) => boolean,
  opts: { only?: IntegrationId; fetchImpl?: FetchLike; mailSource?: (cfg: MailboxConfig) => MailSource; apifyFetch?: ApifyFetch } = {},
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
        const p = new URLSearchParams({ app_id, app_key, results_per_page: "30", what: q.remote === "remote_only" ? `${q.title} remote` : q.title, max_days_old: String(windowDays(s, { integration: "adzuna", country: q.country, query: label(q) })), "content-type": "application/json" });
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
        const p = new URLSearchParams({ query: label(q), country: q.country, date_posted: ((d) => (d <= 1 ? "today" : d <= 3 ? "3days" : d <= 7 ? "week" : "month"))(windowDays(s, { integration: "jsearch", country: q.country, query: label(q) })), num_pages: "1" });
        if (q.remote === "remote_only") p.set("remote_jobs_only", "true");
        return (await jsearchSearch(get, rapidapi_key, p)).map(mapJSearch);
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

  if (want("apify") && creds.apify) {
    const { token } = creds.apify;
    for (const actor of (s.apify_actors ?? []).filter((a) => a.enabled)) {
      // one run per search; an actor whose input never mentions a title or location is run once
      const uses = JSON.stringify(actor.input);
      const searches = /\{\{(title|location|country|country_name)\}\}/.test(uses) ? queries : queries.slice(0, 1);
      for (const q of searches) {
        specs.push({ integration: "apify", country: q.country, query: `${actor.portal}: ${label(q)}`, fetch: async () => {
          const left = s.apify_budget ? await s.apify_budget.remaining() : Number.MAX_SAFE_INTEGER;
          if (left <= 0) throw new Error("The monthly Apify job budget is used up (see Scrapers on the Portals page). It resets next month, or raise the budget if your Apify plan allows.");
          const max = Math.min(actor.max_items, left);
          const items = await runActor(token, { ...actor, max_items: max }, templateVars(q, windowDays(s, { integration: "apify", country: q.country, query: `${actor.portal}: ${label(q)}` }), max), opts.apifyFetch);
          await s.apify_budget?.record(items.length);
          return items.map((i) => mapApifyItem(i, actor, q.country)).filter((j): j is NormalizedJob => j !== null);
        } });
      }
    }
  }

  if (want("mcf")) {
    for (const q of queries.filter((q) => q.country === "sg" && q.remote !== "remote_only")) {
      specs.push({ integration: "mcf", country: "sg", query: label(q), fetch: async () => {
        const p = new URLSearchParams({ search: q.title, limit: "50", page: "0", sortBy: "new_posting_date" });
        const data = await get(`https://api.mycareersfuture.gov.sg/v2/jobs?${p}`);
        return (data.results ?? []).map((r: unknown) => mapMcf(r));
      } });
    }
  }

  if (want("mailbox") && creds.mailbox) {
    const cfg = creds.mailbox;
    specs.push({ integration: "mailbox", query: `${cfg.folder || "INBOX"} (alert emails)`, fetch: async () => (await scanMailbox((opts.mailSource ?? imapSource)(cfg), { sinceDays: Math.min(windowDays(s, { integration: "mailbox", query: `${cfg.folder || "INBOX"} (alert emails)` }), 30) })).jobs });
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
  // companies the agent found on its own: only their jobs that match your titles are kept
  const watchOnly = (ats: "greenhouse" | "lever") => (s.watch?.[ats] ?? []).filter((b) => !(ats === "greenhouse" ? s.greenhouse_boards : s.lever_companies).some((x) => x.toLowerCase() === b.toLowerCase()));
  if (want("greenhouse")) for (const board of watchOnly("greenhouse")) {
    specs.push({ integration: "greenhouse", query: `${board} (found)`, fetch: async () => ((await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`)).jobs ?? []).map((r: unknown) => mapGreenhouse(r, board)).filter(matchesTitle) });
  }
  if (want("lever")) for (const company of watchOnly("lever")) {
    specs.push({ integration: "lever", query: `${company} (found)`, fetch: async () => { const d = await get(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`); return (Array.isArray(d) ? d : []).map((r: unknown) => mapLever(r, company)).filter(matchesTitle); } });
  }
  if (want("boards")) {
    const list = (own: string[] | undefined, found: string[] | undefined) => [...new Set([...(own ?? []), ...(found ?? [])])];
    for (const org of list(s.ashby_orgs, s.watch?.ashby)) specs.push({ integration: "boards", query: `ashby: ${org}`, fetch: async () => ((await get(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`)).jobs ?? []).map((r: unknown) => mapAshby(r, org)).filter(matchesTitle) });
    for (const acct of list(s.workable_accounts, s.watch?.workable)) specs.push({ integration: "boards", query: `workable: ${acct}`, fetch: async () => ((await get(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(acct)}?details=true`)).jobs ?? []).map((r: unknown) => mapWorkable(r, acct)).filter(matchesTitle) });
    for (const co of list(s.recruitee_companies, s.watch?.recruitee)) specs.push({ integration: "boards", query: `recruitee: ${co}`, fetch: async () => ((await get(`https://${encodeURIComponent(co)}.recruitee.com/api/offers/`)).offers ?? []).map((r: unknown) => mapRecruitee(r, co)).filter(matchesTitle) });
  }

  // whatever a source returns, only jobs inside this search's window go on to be stored
  return specs.map((spec) => {
    const days = windowDays(s, spec);
    if (days >= s.max_age_days) return spec;
    return { ...spec, fetch: async () => {
      const cutoff = Date.now() - days * 86_400_000;
      return (await spec.fetch()).filter((j) => !j.postedAt || new Date(j.postedAt).getTime() >= cutoff);
    } };
  });
}

/** A minimal real request per integration, so "Test" proves the credentials and the endpoint work. */
export async function testIntegration(id: IntegrationId, creds: IntegrationCreds, s: DiscoverySettings, fetchImpl?: FetchLike, deps: Pick<ScanDeps, "mailSource" | "apifyFetch"> = {}): Promise<{ ok: boolean; message: string }> {
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
        const found = await jsearchSearch(get, creds.jsearch.rapidapi_key, new URLSearchParams({ query: "engineer in london", num_pages: "1" }));
        return { ok: true, message: `JSearch accepted the key (${found.length} results for the test query; this used 1 request of your plan).` };
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
      case "apify": {
        if (!creds.apify) return { ok: false, message: "Enter your Apify API token first." };
        const r = await (deps.apifyFetch ?? (fetch as unknown as ApifyFetch))("https://api.apify.com/v2/users/me", { method: "GET", headers: { Authorization: `Bearer ${creds.apify.token}` }, signal: AbortSignal.timeout(15_000) });
        if (r.status === 401 || r.status === 403) return { ok: false, message: "Apify rejected the token. Copy it again from Apify > Settings > Integrations." };
        if (!r.ok) return { ok: false, message: `Apify returned HTTP ${r.status}.` };
        const n = (s.apify_actors ?? []).filter((a) => a.enabled).length;
        return { ok: true, message: n ? `Apify accepted the token. ${n} scraper(s) are set up and will run on each scan.` : "Apify accepted the token, but no scrapers are set up yet. Add one under Scrapers below." };
      }
      case "mcf": {
        const d = await get(`https://api.mycareersfuture.gov.sg/v2/jobs?${new URLSearchParams({ search: "manager", limit: "1", page: "0" })}`);
        const first = (d.results ?? [])[0];
        if (!first) return { ok: false, message: "MyCareersFuture answered, but the response had no jobs in the form this app expects. Its search may have changed; use Adzuna and JobStreet alerts for Singapore meanwhile." };
        return { ok: true, message: `MyCareersFuture is reachable (${d.total ?? "some"} jobs; the sample "${String(first.title).slice(0, 60)}" was read correctly).` };
      }
      case "boards": {
        const first = s.ashby_orgs?.[0] ? ["ashby", s.ashby_orgs[0]] : s.workable_accounts?.[0] ? ["workable", s.workable_accounts[0]] : s.recruitee_companies?.[0] ? ["recruitee", s.recruitee_companies[0]] : null;
        if (!first) return { ok: false, message: "No Ashby, Workable or Recruitee companies are listed yet. Add one in Settings > Job discovery." };
        const [kind, name] = first;
        const url = kind === "ashby" ? `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(name)}` : kind === "workable" ? `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(name)}` : `https://${encodeURIComponent(name)}.recruitee.com/api/offers/`;
        const d = await get(url);
        const n = (d.jobs ?? d.offers ?? []).length;
        return { ok: true, message: `${kind} board "${name}" is reachable (${n} open job(s)).` };
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
