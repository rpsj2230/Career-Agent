import { describe, expect, it } from "vitest";
import { buildScanSpecs, windowDays, type DiscoverySettings, type FetchLike } from "@/lib/jobs/sources";

const DAY = 86_400_000;
const base: DiscoverySettings = { countries: ["sg"], roles: ["Product Manager"], greenhouse_boards: [], lever_companies: [], max_age_days: 30 };
const creds = { adzuna: { app_id: "A", app_key: "K" }, jsearch: { rapidapi_key: "R" } };
const now = Date.parse("2026-10-17T12:00:00Z");
const daysAgo = (n: number) => new Date(now - n * DAY);
const res = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("windowDays", () => {
  it("the first search looks back the whole window", () => {
    expect(windowDays(base, { integration: "adzuna", country: "sg", query: "Product Manager" }, now)).toBe(30);
  });
  it("later searches look back only to the last successful run, plus a day of overlap", () => {
    const s = { ...base, since: () => daysAgo(2) };
    expect(windowDays(s, { integration: "adzuna" }, now)).toBe(3);
    expect(windowDays({ ...base, since: () => new Date(now - 3 * 3_600_000) }, { integration: "adzuna" }, now)).toBe(2); // same day: still 1 day + overlap
  });
  it("never looks back further than the maximum age, even if the last run was long ago", () => {
    expect(windowDays({ ...base, since: () => daysAgo(200) }, { integration: "adzuna" }, now)).toBe(30);
    expect(windowDays({ ...base, max_age_days: 7, since: () => daysAgo(200) }, { integration: "adzuna" }, now)).toBe(7);
  });
  it("is looked up per search", () => {
    const s: DiscoverySettings = { ...base, since: (i, c, q) => (i === "adzuna" && c === "sg" && q === "Product Manager" ? daysAgo(1) : null) };
    expect(windowDays(s, { integration: "adzuna", country: "sg", query: "Product Manager" }, now)).toBe(2);
    expect(windowDays(s, { integration: "adzuna", country: "sg", query: "Analyst" }, now)).toBe(30);
  });
});

describe("what is asked of each source", () => {
  it("Adzuna and JSearch are asked only for jobs since the last run", async () => {
    const urls: string[] = [];
    const f: FetchLike = async (u) => { urls.push(String(u)); return res({ results: [], data: [] }); };
    const s: DiscoverySettings = { ...base, since: () => new Date(Date.now() - 2 * DAY) };
    for (const spec of buildScanSpecs(s, creds, () => true, { only: undefined, fetchImpl: f }).filter((x) => x.integration === "adzuna" || x.integration === "jsearch")) await spec.fetch();
    expect(urls.find((u) => u.includes("adzuna"))).toContain("max_days_old=3");
    expect(urls.find((u) => u.includes("jsearch"))).toContain("date_posted=3days");
  });
  it("without a previous run they ask for the full window", async () => {
    const urls: string[] = [];
    const f: FetchLike = async (u) => { urls.push(String(u)); return res({ results: [], data: [] }); };
    for (const spec of buildScanSpecs(base, creds, () => true, { fetchImpl: f }).filter((x) => x.integration === "adzuna" || x.integration === "jsearch")) await spec.fetch();
    expect(urls.find((u) => u.includes("adzuna"))).toContain("max_days_old=30");
    expect(urls.find((u) => u.includes("jsearch"))).toContain("date_posted=month");
  });
  it("a feed that cannot filter by date is trimmed to the window before anything is stored", async () => {
    const old = new Date(Date.now() - 10 * DAY).toISOString(), recent = new Date(Date.now() - 3_600_000).toISOString();
    const f: FetchLike = async () => res({ jobs: [
      { id: 1, title: "Product Manager", company_name: "Old Co", url: "https://remotive.com/1", description: "d", publication_date: old },
      { id: 2, title: "Product Manager", company_name: "New Co", url: "https://remotive.com/2", description: "d", publication_date: recent },
    ] });
    const s: DiscoverySettings = { ...base, since: () => new Date(Date.now() - 2 * DAY) };
    const spec = buildScanSpecs(s, {}, (id) => id === "remotive", { fetchImpl: f })[0];
    expect((await spec.fetch()).map((j) => j.company)).toEqual(["New Co"]);
  });
  it("a job with no date is kept (nothing is lost for lack of a date)", async () => {
    const f: FetchLike = async () => res({ jobs: [{ id: 3, title: "Product Manager", company_name: "Undated", url: "https://remotive.com/3", description: "d" }] });
    const spec = buildScanSpecs({ ...base, since: () => new Date(Date.now() - 2 * DAY) }, {}, (id) => id === "remotive", { fetchImpl: f })[0];
    expect(await spec.fetch()).toHaveLength(1);
  });
});
