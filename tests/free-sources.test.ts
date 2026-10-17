import { describe, expect, it } from "vitest";
import { parseAlertEmail, senderPortal } from "@/lib/jobs/email-parse";
import { mapMcf } from "@/lib/jobs/map";
import { buildScanSpecs, testIntegration, type DiscoverySettings, type FetchLike } from "@/lib/jobs/sources";
import { ApifyActor } from "@/lib/jobs/apify";
import { detectPortal } from "@/lib/jobs/portal";

const mail = (from: string, links: [string, string, string][]) => ({
  from: `Alerts <jobs@${from}>`, subject: "New jobs for you", date: new Date("2026-10-10"),
  html: `<html><body>${links.map(([href, title, ctx]) => `<div><a href="${href}">${title}</a><p>${ctx}</p></div>`).join("")}<a href="https://${from}/unsubscribe">Unsubscribe</a></body></html>`,
});

describe("alert emails from more portals", () => {
  const cases: [string, string, string, string, string][] = [
    ["bayt.com", "https://www.bayt.com/en/uae/jobs/product-manager-dubai-4731259/?ref=email", "bayt", "4731259", "https://www.bayt.com/en/uae/jobs/product-manager-dubai-4731259/"],
    ["naukrigulf.com", "https://www.naukrigulf.com/product-manager-jobs-in-dubai-jid-120926012345", "naukrigulf", "120926012345", "https://www.naukrigulf.com/product-manager-jobs-in-dubai-jid-120926012345"],
    ["gulftalent.com", "https://www.gulftalent.com/uae/jobs/senior-product-manager-48213", "gulftalent", "48213", "https://www.gulftalent.com/uae/jobs/senior-product-manager-48213"],
    ["foundit.in", "https://www.foundit.in/job/product-manager-acme-bengaluru-12345678", "foundit", "12345678", "https://www.foundit.in/job/product-manager-acme-bengaluru-12345678"],
    ["shine.com", "https://www.shine.com/jobs/product-manager/acme/12345678/", "shine", "12345678", "https://www.shine.com/jobs/product-manager/acme/12345678/"],
    ["seek.com.au", "https://www.seek.com.au/job/81234567?type=standard&ref=email", "seek", "81234567", "https://www.seek.com.au/job/81234567"],
    ["jobstreet.com", "https://sg.jobstreet.com/job/81234567?ref=email", "jobstreet", "81234567", "https://sg.jobstreet.com/job/81234567"],
    ["jobsdb.com", "https://hk.jobsdb.com/job/81234567", "jobsdb", "81234567", "https://hk.jobsdb.com/job/81234567"],
  ];
  it.each(cases)("%s: reads the job, labels the portal and keeps a clean link", (domain, href, portal, id, url) => {
    const jobs = parseAlertEmail(mail(domain, [[href, "Product Manager", "Acme Pte Ltd · Singapore"]]));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ title: "Product Manager", company: "Acme Pte Ltd", url, publisher: portal, externalId: `${portal}-${id}` });
    expect(detectPortal({ url: jobs[0].url, publisher: jobs[0].publisher, integration: "mailbox" })).toBe(portal);
  });
  it("ignores links that are not job pages, and mail that only claims to be from a portal", () => {
    expect(parseAlertEmail(mail("bayt.com", [["https://www.bayt.com/en/uae/jobs/", "See all jobs here", ""], ["https://www.bayt.com/en/account/", "Your account", ""]]))).toEqual([]);
    const spoof = { ...mail("bayt.com", [["https://evil.example/jobs/x-4731259/", "Product Manager", ""]]) };
    expect(parseAlertEmail(spoof)).toEqual([]);
    expect(senderPortal("Alerts <jobs@bayt.com.evil.example>")).toBeNull();
  });
  it("a link on another portal's domain inside a Bayt email is not accepted", () => {
    expect(parseAlertEmail(mail("bayt.com", [["https://www.seek.com.au/job/81234567", "Product Manager", ""]]))).toEqual([]);
  });
});

describe("MyCareersFuture", () => {
  const sample = { uuid: "abc-123", title: "Senior Product Manager", description: "<p>Own the <b>roadmap</b>.</p>", postedCompany: { name: "Acme Pte Ltd" }, address: { districts: [{ region: "Central" }] }, salary: { minimum: 9000, maximum: 12000, type: { salaryType: "Monthly" } }, metadata: { jobDetailsUrl: "https://www.mycareersfuture.gov.sg/job/product/senior-product-manager-abc-123", originalPostingDate: "2026-10-10" } };
  it("maps a result with a monthly salary", () => {
    const j = mapMcf(sample);
    expect(j).toMatchObject({ source: "mcf", externalId: "abc-123", title: "Senior Product Manager", company: "Acme Pte Ltd", country: "sg", publisher: "mycareersfuture", url: sample.metadata.jobDetailsUrl, salary: { min: 9000, max: 12000, currency: "SGD", period: "month" } });
    expect(j.description).toBe("Own the roadmap.");
    expect(j.postedAt).toBe("2026-10-10T00:00:00.000Z");
  });
  it("still maps a sparse result and builds the link from the id", () => {
    const j = mapMcf({ uuid: "zzz", title: "PM" });
    expect(j).toMatchObject({ company: "Unknown", url: "https://www.mycareersfuture.gov.sg/job/zzz", salary: undefined });
  });
  const settings: DiscoverySettings = { countries: ["sg", "in"], roles: [], greenhouse_boards: [], lever_companies: [], max_age_days: 14, perCountry: [
    { country: "sg", titles: ["Product Manager", "Program Manager"], industries: [], locations: [], remote: "any", salary: { min: null, max: null, currency: null }, workAuthorisation: null, needsSponsorship: null, notes: null, fallback: false },
    { country: "in", titles: ["Product Manager"], industries: [], locations: [], remote: "any", salary: { min: null, max: null, currency: null }, workAuthorisation: null, needsSponsorship: null, notes: null, fallback: false },
  ] };
  it("searches Singapore only, once per title, with no key", async () => {
    const urls: string[] = [];
    const f: FetchLike = async (u) => { urls.push(String(u)); return { ok: true, status: 200, json: async () => ({ results: [sample] }) } as Response; };
    const specs = buildScanSpecs(settings, {}, (id) => id === "mcf", { fetchImpl: f });
    expect(specs.map((s) => s.query)).toEqual(["Product Manager", "Program Manager"]);
    const jobs = await specs[0].fetch();
    expect(jobs).toHaveLength(1);
    expect(urls[0]).toContain("api.mycareersfuture.gov.sg/v2/jobs");
    expect(urls[0]).toContain("search=Product+Manager");
  });
  it("Test says clearly when the response is not in the expected form", async () => {
    const bad: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) } as Response);
    expect((await testIntegration("mcf", {}, settings, bad)).ok).toBe(false);
    const good: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ results: [sample], total: 500 }) } as Response);
    expect(await testIntegration("mcf", {}, settings, good)).toMatchObject({ ok: true });
  });
});

describe("Apify monthly budget", () => {
  const actor = ApifyActor.parse({ id: "u~a", portal: "linkedin", input: { q: "{{title}}" }, max_items: 50 });
  const settings = (remaining: number, recorded: number[]): DiscoverySettings => ({
    countries: ["sg"], roles: ["Product Manager"], greenhouse_boards: [], lever_companies: [], max_age_days: 14, apify_actors: [actor],
    apify_budget: { remaining: async () => remaining, record: async (n) => { recorded.push(n); } },
  });
  const fakeFetch = (n: number, bodies: string[]) => async (_u: string, init: { body?: string }) => { bodies.push(init.body ?? ""); return { ok: true, status: 200, json: async () => Array.from({ length: n }, (_, i) => ({ title: "PM", companyName: "A", jobUrl: `https://www.linkedin.com/jobs/view/${100000 + i}` })) }; };
  it("never asks for more jobs than the budget has left, and records what it used", async () => {
    const recorded: number[] = [], bodies: string[] = [];
    const spec = buildScanSpecs(settings(12, recorded), { apify: { token: "t" } }, (id) => id === "apify", { apifyFetch: fakeFetch(3, bodies) as never })[0];
    const jobs = await spec.fetch();
    expect(jobs).toHaveLength(3);
    expect(recorded).toEqual([3]);
  });
  it("stops with a clear message once the budget is used up, without calling Apify", async () => {
    const bodies: string[] = [];
    const spec = buildScanSpecs(settings(0, []), { apify: { token: "t" } }, (id) => id === "apify", { apifyFetch: fakeFetch(3, bodies) as never })[0];
    await expect(spec.fetch()).rejects.toThrow(/monthly Apify job budget is used up/);
    expect(bodies).toEqual([]);
  });
});
