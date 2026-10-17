import { describe, expect, it } from "vitest";
import { EMPTY_WATCHLIST, mergeWatchlist, parseAtsUrl } from "@/lib/jobs/ats";
import { mapAshby, mapRecruitee, mapWorkable } from "@/lib/jobs/map";
import { buildScanSpecs, testIntegration, type DiscoverySettings, type FetchLike } from "@/lib/jobs/sources";

describe("parseAtsUrl", () => {
  it.each([
    ["https://boards.greenhouse.io/acme/jobs/123", "greenhouse", "acme"],
    ["https://job-boards.greenhouse.io/acme/jobs/123", "greenhouse", "acme"],
    ["https://boards.eu.greenhouse.io/acme/jobs/9", "greenhouse", "acme"],
    ["https://jobs.lever.co/globex/abc-def", "lever", "globex"],
    ["https://jobs.eu.lever.co/globex/abc-def/apply", "lever", "globex"],
    ["https://jobs.ashbyhq.com/ramp/1234-5678", "ashby", "ramp"],
    ["https://apply.workable.com/initech/j/ABC123DEF/", "workable", "initech"],
    ["https://hooli.recruitee.com/o/product-manager", "recruitee", "hooli"],
  ])("%s", (url, ats, board) => expect(parseAtsUrl(url)).toEqual({ ats, board }));
  it("ignores everything else", () => {
    for (const u of ["https://www.linkedin.com/jobs/view/1", "https://boards.greenhouse.io/embed/job_app?token=1", "https://boards.greenhouse.io/", "https://www.recruitee.com/o/x", "https://lever.co/", "ftp://boards.greenhouse.io/a/jobs/1", "not a url", "https://evil.example/boards.greenhouse.io/acme/jobs/1"]) expect(parseAtsUrl(u), u).toBeNull();
  });
});

describe("mergeWatchlist", () => {
  const urls = ["https://boards.greenhouse.io/acme/jobs/1", "https://boards.greenhouse.io/acme/jobs/2", "https://jobs.lever.co/globex/x", "https://jobs.ashbyhq.com/ramp/1", "https://careers.bigco.com/1"];
  it("adds each company once and records when", () => {
    const { watchlist, added } = mergeWatchlist(EMPTY_WATCHLIST, urls, {}, 150, new Date("2026-10-17T00:00:00Z"));
    expect(added.map((a) => `${a.ats}:${a.board}`)).toEqual(["greenhouse:acme", "lever:globex", "ashby:ramp"]);
    expect(watchlist.boards.greenhouse).toEqual(["acme"]);
    expect(watchlist.added["ashby:ramp"]).toBe("2026-10-17T00:00:00.000Z");
  });
  it("does not repeat boards you listed or already have (any letter case), and does not change its input", () => {
    const first = mergeWatchlist(EMPTY_WATCHLIST, urls, { greenhouse: ["ACME"] });
    expect(first.watchlist.boards.greenhouse).toEqual([]);
    const again = mergeWatchlist(first.watchlist, urls, { greenhouse: ["ACME"] });
    expect(again.added).toEqual([]);
    expect(EMPTY_WATCHLIST.boards.greenhouse).toEqual([]);
  });
  it("is capped per ATS", () => {
    const many = Array.from({ length: 10 }, (_, i) => `https://boards.greenhouse.io/co${i}/jobs/1`);
    expect(mergeWatchlist(EMPTY_WATCHLIST, many, {}, 4).watchlist.boards.greenhouse).toHaveLength(4);
  });
});

describe("board adapters", () => {
  it("Ashby", () => {
    const j = mapAshby({ id: "a1", title: "Product Manager", location: "Singapore", jobUrl: "https://jobs.ashbyhq.com/ramp/a1", descriptionHtml: "<p>Own the <b>roadmap</b></p>", publishedAt: "2026-10-10T00:00:00Z", compensation: { compensationTierSummary: "$150K - $200K" } }, "ramp");
    expect(j).toMatchObject({ source: "ashby:ramp", externalId: "a1", company: "ramp", country: "sg", url: "https://jobs.ashbyhq.com/ramp/a1", salaryText: "$150K - $200K" });
    expect(j.description).toBe("Own the roadmap");
  });
  it("Workable", () => {
    const j = mapWorkable({ shortcode: "ABC123", title: "Product Manager", city: "Dubai", country: "United Arab Emirates", url: "https://apply.workable.com/initech/j/ABC123/", description: "<p>Lead</p>", published_on: "2026-10-09" }, "initech");
    expect(j).toMatchObject({ externalId: "ABC123", country: "ae", url: "https://apply.workable.com/initech/j/ABC123/" });
  });
  it("Recruitee", () => {
    const j = mapRecruitee({ id: 77, title: "Product Manager", careers_url: "https://hooli.recruitee.com/o/pm", location: "Berlin", country_code: "DE", description: "<p>A</p>", requirements: "<p>B</p>" }, "hooli");
    expect(j).toMatchObject({ country: "de", url: "https://hooli.recruitee.com/o/pm" });
    expect(j.description).toContain("A");
    expect(j.description).toContain("B");
  });
});

describe("scans of listed and discovered boards", () => {
  const settings: DiscoverySettings = { countries: ["sg"], roles: ["Product Manager"], greenhouse_boards: ["mine"], lever_companies: [], ashby_orgs: ["ramp"], max_age_days: 30, watch: { greenhouse: ["mine", "found"], lever: ["globex"], workable: ["initech"] } };
  const f: FetchLike = async (u) => {
    const url = String(u);
    const body = url.includes("greenhouse") ? { jobs: [{ id: 1, title: "Product Manager", company_name: "Acme", absolute_url: "https://boards.greenhouse.io/found/jobs/1", content: "d" }, { id: 2, title: "Office Cleaner", absolute_url: "https://boards.greenhouse.io/found/jobs/2", content: "d" }] }
      : url.includes("lever") ? [{ id: "l1", text: "Product Manager", hostedUrl: "https://jobs.lever.co/globex/l1" }, { id: "l2", text: "Accountant", hostedUrl: "https://jobs.lever.co/globex/l2" }]
      : url.includes("ashby") ? { jobs: [{ id: "a1", title: "Senior Product Manager", jobUrl: "https://jobs.ashbyhq.com/ramp/a1", descriptionPlain: "d" }, { id: "a2", title: "Chef", jobUrl: "https://jobs.ashbyhq.com/ramp/a2" }] }
      : { jobs: [{ shortcode: "W1", title: "Product Manager", url: "https://apply.workable.com/initech/j/W1/" }] };
    return { ok: true, status: 200, json: async () => body } as Response;
  };
  it("reads each board, and keeps only the matching titles on boards you did not list yourself", async () => {
    const specs = buildScanSpecs(settings, {}, (id) => ["greenhouse", "lever", "boards"].includes(id), { fetchImpl: f });
    const byQuery = Object.fromEntries(await Promise.all(specs.map(async (s) => [`${s.integration}:${s.query}`, (await s.fetch()).map((j) => j.title)])));
    expect(byQuery["greenhouse:mine"]).toEqual(["Product Manager", "Office Cleaner"]); // your own list: everything, as before
    expect(byQuery["greenhouse:found (found)"]).toEqual(["Product Manager"]);
    expect(byQuery["greenhouse:mine (found)"]).toBeUndefined(); // a listed board is not scanned twice
    expect(byQuery["lever:globex (found)"]).toEqual(["Product Manager"]);
    expect(byQuery["boards:ashby: ramp"]).toEqual(["Senior Product Manager"]);
    expect(byQuery["boards:workable: initech"]).toEqual(["Product Manager"]);
  });
  it("Test names the first listed board and says clearly when none is listed", async () => {
    expect(await testIntegration("boards", {}, settings, f)).toMatchObject({ ok: true });
    expect((await testIntegration("boards", {}, { ...settings, ashby_orgs: [] }, f)).ok).toBe(false);
  });
});
