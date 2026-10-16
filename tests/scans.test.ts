import { describe, expect, it, vi } from "vitest";
import { runScans, type ScanDeps } from "@/lib/jobs/scans";
import { buildScanSpecs, jsonFetcher, testIntegration, type DiscoverySettings, type FetchLike } from "@/lib/jobs/sources";
import { planInsert } from "@/lib/jobs/plan";
import type { NormalizedJob } from "@/lib/jobs/normalize";

const settings: DiscoverySettings = { countries: ["sg", "au", "xx"], roles: ["Product Manager", "Analyst"], greenhouse_boards: ["acme"], lever_companies: ["globex"], max_age_days: 14 };
const creds = { adzuna: { app_id: "AID", app_key: "AKEY" }, jsearch: { rapidapi_key: "RKEY" } };
const all = () => true;

const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe("buildScanSpecs", () => {
  it("creates one scan per integration, country and role, skipping countries Adzuna does not serve", () => {
    const specs = buildScanSpecs(settings, creds, all);
    const count = (id: string) => specs.filter((s) => s.integration === id).length;
    expect(count("adzuna")).toBe(2 * 2);      // sg, au x 2 roles; "xx" unsupported
    expect(count("jsearch")).toBe(3 * 2);     // every country x 2 roles
    expect(count("remotive")).toBe(2);        // per role, not per country
    expect(count("greenhouse")).toBe(1);
    expect(count("lever")).toBe(1);
  });
  it("leaves out integrations that are disabled or have no credentials, and honours `only`", () => {
    expect(buildScanSpecs(settings, {}, all).some((s) => s.integration === "adzuna" || s.integration === "jsearch")).toBe(false);
    expect(buildScanSpecs(settings, creds, (id) => id !== "jsearch").some((s) => s.integration === "jsearch")).toBe(false);
    expect(new Set(buildScanSpecs(settings, creds, all, { only: "remotive" }).map((s) => s.integration))).toEqual(new Set(["remotive"]));
  });
});

describe("spec.fetch", () => {
  it("sends Adzuna credentials and maps the results with the country", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(res({ results: [{ id: 1, title: "PM", company: { display_name: "Acme" }, location: { display_name: "Singapore" }, redirect_url: "https://adzuna.sg/x", description: "d" }] }));
    const spec = buildScanSpecs(settings, creds, all, { only: "adzuna", fetchImpl: f })[0];
    const jobs = await spec.fetch();
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain("/jobs/sg/search/1");
    expect(url).toContain("app_id=AID");
    expect(jobs[0]).toMatchObject({ source: "adzuna", country: "sg", title: "PM" });
  });
  it("sends the RapidAPI key as a header and records the PUBLISHER as the origin portal", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(res({ data: [
      { job_id: "a", job_title: "PM", employer_name: "Acme", job_country: "SG", job_apply_link: "https://acme.com/apply/1", job_description: "d".repeat(100), job_publisher: "LinkedIn" },
      { job_id: "b", job_title: "PM", employer_name: "Beta", job_country: "SG", job_apply_link: "https://www.indeed.com/viewjob?jk=1", job_description: "d".repeat(100), job_publisher: "Indeed" },
    ] }));
    const spec = buildScanSpecs(settings, creds, all, { only: "jsearch", fetchImpl: f })[0];
    const jobs = await spec.fetch();
    expect((f.mock.calls[0][1]?.headers as Record<string, string>)["X-RapidAPI-Key"]).toBe("RKEY");
    expect(jobs.map((j) => j.publisher)).toEqual(["LinkedIn", "Indeed"]);
    const plan = planInsert(jobs, new Set(), 36500);
    expect(plan.rows.map((r) => r.portal)).toEqual(["linkedin", "indeed"]); // even though the apply link points at the employer
  });
  it("turns an HTTP failure into an actionable message", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(res({}, 429));
    await expect(buildScanSpecs(settings, creds, all, { only: "jsearch", fetchImpl: f })[0].fetch()).rejects.toThrow(/quota or rate limit/);
    const down = vi.fn<FetchLike>().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    await expect(jsonFetcher(down)("https://api.adzuna.com/x")).rejects.toThrow(/Could not reach api\.adzuna\.com/);
  });
});

function fakeDeps(over: Partial<ScanDeps> = {}) {
  const log = { started: [] as unknown[], finished: [] as { id: string | null; r: Record<string, unknown> }[], integrations: [] as { id: string; r: Record<string, unknown> }[] };
  let n = 0;
  const deps: ScanDeps = {
    startScan: async (m) => { log.started.push(m); return `scan-${++n}`; },
    finishScan: async (id, _m, r) => { log.finished.push({ id, r }); },
    ingest: async (jobs) => ({ inserted: jobs.length, duplicates: 0, stale: 0, invalid: 0 }),
    recordIntegration: async (id, r) => { log.integrations.push({ id, r }); },
    ...over,
  };
  return { deps, log };
}
const job = (i: number): NormalizedJob => ({ source: "x", externalId: String(i), title: "t", company: "c", url: "https://x", description: "d" });

describe("runScans", () => {
  it("records every scan and updates each integration from its results", async () => {
    const specs = [
      { integration: "adzuna" as const, country: "sg", query: "PM", fetch: async () => [job(1), job(2)] },
      { integration: "adzuna" as const, country: "au", query: "PM", fetch: async () => [job(3)] },
      { integration: "remotive" as const, query: "PM", fetch: async () => [] },
    ];
    const { deps, log } = fakeDeps();
    const out = await runScans(specs, deps);
    expect(out.outcomes.map((o) => o.counts.fetched)).toEqual([2, 1, 0]);
    expect(log.finished.every((f) => f.r.status === "ok")).toBe(true);
    expect(log.integrations).toEqual([{ id: "adzuna", r: { ok: true, error: undefined, inserted: 3 } }, { id: "remotive", r: { ok: true, error: undefined, inserted: 0 } }]);
  });
  it("a failing source is recorded with its reason and does not stop the others", async () => {
    const specs = [
      { integration: "jsearch" as const, country: "in", query: "PM", fetch: async (): Promise<NormalizedJob[]> => { throw new Error("jsearch.p.rapidapi.com says the request quota or rate limit is used up (HTTP 429)."); } },
      { integration: "adzuna" as const, country: "in", query: "PM", fetch: async () => [job(1)] },
    ];
    const { deps, log } = fakeDeps();
    const out = await runScans(specs, deps);
    expect(out.outcomes.map((o) => o.ok)).toEqual([false, true]);
    expect(log.finished[0]).toMatchObject({ id: "scan-1", r: { status: "error" } });
    expect(String(log.finished[0].r.error)).toContain("429");
    expect(log.integrations.find((i) => i.id === "jsearch")?.r).toMatchObject({ ok: false });
    expect(log.integrations.find((i) => i.id === "adzuna")?.r).toMatchObject({ ok: true, inserted: 1 });
  });
  it("records a scan as failed when ingestion throws (nothing is left 'running')", async () => {
    const { deps, log } = fakeDeps({ ingest: async () => { throw new Error("insert jobs: connection reset"); } });
    await runScans([{ integration: "remotive", query: "PM", fetch: async () => [job(1)] }], deps);
    expect(log.finished).toHaveLength(1);
    expect(log.finished[0].r).toMatchObject({ status: "error" });
  });
  it("stops starting scans when the time budget is used and reports how many were left", async () => {
    let t = 0;
    const { deps, log } = fakeDeps({ now: () => t });
    const specs = [1, 2, 3, 4].map((i) => ({ integration: "remotive" as const, query: `q${i}`, fetch: async () => { t += 20_000; return [job(i)]; } }));
    const out = await runScans(specs, deps, { budgetMs: 30_000 });
    expect(out.outcomes).toHaveLength(2);
    expect(out.skipped).toBe(2);
    expect(log.started).toHaveLength(2);
  });
  it("passes through the 'database not migrated' flag", async () => {
    const { deps } = fakeDeps({ ingest: async () => ({ inserted: 1, duplicates: 0, stale: 0, invalid: 0, legacy: true }) });
    expect((await runScans([{ integration: "remotive", query: "q", fetch: async () => [job(1)] }], deps)).legacy).toBe(true);
  });
});

describe("testIntegration", () => {
  it("passes when the provider accepts the request and says so", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(res({ count: 1234 }));
    const r = await testIntegration("adzuna", creds, settings, f);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("1234");
  });
  it("fails with the provider's reason, and asks for credentials that are missing", async () => {
    expect((await testIntegration("jsearch", creds, settings, vi.fn<FetchLike>().mockResolvedValue(res({}, 401)))).message).toMatch(/rejected the credentials/);
    expect(await testIntegration("adzuna", {}, settings)).toMatchObject({ ok: false });
    expect((await testIntegration("greenhouse", {}, { ...settings, greenhouse_boards: [] })).message).toMatch(/No Greenhouse boards/);
    expect((await testIntegration("mailbox", {}, settings)).ok).toBe(false);
    expect((await testIntegration("manual", {}, settings)).ok).toBe(true);
  });
});

describe("per-country scan queries", () => {
  const pc = [
    { country: "sg", titles: ["Product Manager"], industries: [], locations: ["Singapore", "Remote"], remote: "any" as const, salary: { min: null, max: null, currency: null }, workAuthorisation: null, needsSponsorship: null, notes: null, fallback: false },
    { country: "gb", titles: ["Program Manager"], industries: [], locations: [], remote: "onsite_only" as const, salary: { min: null, max: null, currency: null }, workAuthorisation: null, needsSponsorship: null, notes: null, fallback: false },
  ];
  const s2: DiscoverySettings = { ...settings, countries: ["sg", "gb"], roles: ["x"], perCountry: pc };
  it("uses each country's own titles and locations, not the general roles", () => {
    const specs = buildScanSpecs(s2, creds, all, { only: "jsearch" });
    expect(specs.map((x) => `${x.country}:${x.query}`)).toEqual(["sg:Product Manager in Singapore", "sg:Product Manager in Remote", "gb:Program Manager"]);
  });
  it("sends the location and the remote flag to the provider", async () => {
    const urls: string[] = [];
    const f: FetchLike = async (u) => { urls.push(String(u)); return new Response(JSON.stringify({ results: [], data: [] })); };
    await buildScanSpecs(s2, creds, all, { only: "adzuna", fetchImpl: f })[0].fetch();
    expect(urls[0]).toContain("/jobs/sg/search/1");
    expect(urls[0]).toContain("where=Singapore");
    const r = await buildScanSpecs({ ...s2, perCountry: [{ ...pc[0], remote: "remote_only" as const }] }, creds, all, { only: "jsearch", fetchImpl: f })[0].fetch();
    expect(r).toEqual([]);
    expect(urls[1]).toContain("remote_jobs_only=true");
  });
  it("searches Remotive once per title and never for on-site-only countries", () => {
    expect(buildScanSpecs(s2, creds, all, { only: "remotive" }).map((x) => x.query)).toEqual(["Product Manager"]);
  });
});
