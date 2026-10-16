import "server-only";
import { mapAdzuna, mapGreenhouse, mapJSearch, mapLever, mapRemotive } from "./map";
import type { NormalizedJob } from "./normalize";

export type DiscoverySettings = {
  countries: string[];
  roles: string[];
  greenhouse_boards: string[];
  lever_companies: string[];
  max_age_days: number;
};

/** Countries the Adzuna API serves. Extend if Adzuna adds more. */
export const ADZUNA_COUNTRIES = ["at", "au", "be", "br", "ca", "ch", "de", "es", "fr", "gb", "in", "it", "mx", "nl", "nz", "pl", "sg", "us", "za"];

export type SourceResult = { source: string; jobs: NormalizedJob[]; error?: string };

async function getJson(url: string, init?: RequestInit): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).hostname}`);
  return res.json();
}

async function guard(source: string, fn: () => Promise<NormalizedJob[]>): Promise<SourceResult> {
  try { return { source, jobs: await fn() }; }
  catch (e) { return { source, jobs: [], error: e instanceof Error ? e.message : String(e) }; }
}

export function discover(s: DiscoverySettings, env: Record<string, string | undefined> = process.env): Promise<SourceResult[]> {
  const tasks: Promise<SourceResult>[] = [];

  if (env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) {
    for (const c of s.countries.filter((c) => ADZUNA_COUNTRIES.includes(c))) {
      for (const role of s.roles) {
        tasks.push(guard(`adzuna:${c}:${role}`, async () => {
          const q = new URLSearchParams({
            app_id: env.ADZUNA_APP_ID!, app_key: env.ADZUNA_APP_KEY!, results_per_page: "30",
            what: role, max_days_old: String(s.max_age_days), "content-type": "application/json",
          });
          const data = await getJson(`https://api.adzuna.com/v1/api/jobs/${c}/search/1?${q}`);
          return (data.results ?? []).map((r: unknown) => mapAdzuna(r, c));
        }));
      }
    }
  }

  if (env.RAPIDAPI_KEY) {
    for (const c of s.countries) {
      for (const role of s.roles) {
        tasks.push(guard(`jsearch:${c}:${role}`, async () => {
          const q = new URLSearchParams({ query: role, country: c, date_posted: s.max_age_days <= 7 ? "week" : "month", num_pages: "1" });
          const data = await getJson(`https://jsearch.p.rapidapi.com/search?${q}`, {
            headers: { "X-RapidAPI-Key": env.RAPIDAPI_KEY!, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
          });
          return (data.data ?? []).map(mapJSearch);
        }));
      }
    }
  }

  // Remote roles are global; only query when the user wants remote-friendly results.
  for (const role of s.roles) {
    tasks.push(guard(`remotive:${role}`, async () => {
      const data = await getJson(`https://remotive.com/api/remote-jobs?${new URLSearchParams({ search: role, limit: "30" })}`);
      return (data.jobs ?? []).map(mapRemotive);
    }));
  }

  for (const board of s.greenhouse_boards) {
    tasks.push(guard(`greenhouse:${board}`, async () => {
      const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`);
      return (data.jobs ?? []).map((r: unknown) => mapGreenhouse(r, board));
    }));
  }
  for (const company of s.lever_companies) {
    tasks.push(guard(`lever:${company}`, async () => {
      const data = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`);
      return (Array.isArray(data) ? data : []).map((r: unknown) => mapLever(r, company));
    }));
  }
  return Promise.all(tasks);
}
