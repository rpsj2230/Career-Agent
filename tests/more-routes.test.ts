import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { careersSiteRoutes, employerSites, googleJobsRoutes, linksIn, mentionsCompany, readJobPostingLd, type MoreDeps } from "@/lib/jobs/more-routes";

const careers = readFileSync("tests/fixtures/careers-page.html", "utf8");
const job = { title: "Head of Artificial Intelligence", company: "Cygnify Pte Ltd", location: "Singapore", description: "Apply at https://www.cygnify.com/careers or write to talent@cygnify.com. Also see https://sg.linkedin.com/jobs/view/123456" };

const jsonLd = (o: unknown) => `<html><script type="application/ld+json">${JSON.stringify(o)}</script></html>`;

describe("what a job page says about itself", () => {
  it("reads the employer and apply link from schema.org JobPosting data, also inside @graph", () => {
    const ld = readJobPostingLd(jsonLd({ "@graph": [{ "@type": "WebSite" }, { "@type": "JobPosting", directApply: true, url: "https://jobs.lever.co/cygnify/abc-123", hiringOrganization: { "@type": "Organization", name: "Cygnify", sameAs: "https://www.cygnify.com", url: "https://www.linkedin.com/company/cygnify" } }] }));
    expect(ld.directApply).toBe(true);
    expect(ld.applyUrls).toEqual(["https://jobs.lever.co/cygnify/abc-123"]);
    expect(ld.employerSites).toContain("https://www.cygnify.com");
  });
  it("ignores broken or unrelated data", () => {
    expect(readJobPostingLd(`<script type="application/ld+json">{nope</script>`)).toEqual({ employerSites: [], applyUrls: [], directApply: false });
    expect(readJobPostingLd(jsonLd({ "@type": "Product" })).employerSites).toEqual([]);
  });
});

describe("finding the employer's own site", () => {
  it("keeps the employer, drops job boards, social links and free mail", () => {
    const sites = employerSites(job, readJobPostingLd(jsonLd({ "@type": "JobPosting", hiringOrganization: { sameAs: ["https://www.linkedin.com/company/cygnify", "https://cygnify.com"] } })));
    expect(sites).toEqual(["https://cygnify.com"]);
    expect(employerSites({ ...job, description: "mail me at someone@gmail.com" }, null)).toEqual([]);
  });
  it("uses the domain of a hiring address that names the company", () => {
    expect(employerSites({ ...job, description: "send your CV to hr@cygnify.com" }, null)).toEqual(["https://cygnify.com"]);
    expect(employerSites({ ...job, description: "send your CV to hr@unrelated.com" }, null)).toEqual([]);
  });
  it("knows whether a page is about the company", () => {
    expect(mentionsCompany("Careers at Cygnify", "Cygnify Pte Ltd")).toBe(true);
    expect(mentionsCompany("Welcome to Acme", "Cygnify Pte Ltd")).toBe(false);
  });
  it("reads links and their text", () => {
    expect(linksIn(careers, "https://cygnify.com/careers").map((l) => l.text)).toContain("Head of Artificial Intelligence");
  });
});

describe("the careers page route", () => {
  const pages: Record<string, string> = { "https://cygnify.com/careers": careers };
  const boardJobs = { jobs: [{ id: 1, title: "Head of Artificial Intelligence", absolute_url: "https://boards.greenhouse.io/cygnifyhq/jobs/1", location: { name: "Singapore" } }] };
  const deps = (over: Partial<MoreDeps> = {}): MoreDeps => ({
    getHtml: async (u) => pages[u] ?? null,
    getJson: async (u) => (u.includes("greenhouse") && u.includes("cygnifyhq") ? boardJobs : null),
    ...over,
  });
  it("follows the board a careers page links to, by its real name rather than a guess", async () => {
    const found = await careersSiteRoutes(job, deps());
    expect(found[0]).toMatchObject({ url: "https://boards.greenhouse.io/cygnifyhq/jobs/1", ats: "greenhouse" });
    expect(found[0].how).toMatch(/careers page's greenhouse board \(cygnifyhq\)/);
  });
  it("also offers the job's own link on the careers page", async () => {
    const found = await careersSiteRoutes(job, deps({ getJson: async () => null }));
    expect(found).toEqual([expect.objectContaining({ url: "https://cygnify.com/careers/head-of-ai", ats: "none" })]);
  });
  it("never trusts a careers page that does not name the company", async () => {
    const found = await careersSiteRoutes(job, deps({ getHtml: async () => careers.replace(/Cygnify/g, "Someone Else") }));
    expect(found).toEqual([]);
  });
  it("uses the apply link in the job page's own data", async () => {
    const html = jsonLd({ "@type": "JobPosting", url: "https://jobs.lever.co/cygnify/abc-123" });
    const found = await careersSiteRoutes({ ...job, description: "" }, deps(), html);
    expect(found[0]).toMatchObject({ url: "https://jobs.lever.co/cygnify/abc-123", ats: "lever" });
  });
  it("copes with every fetch failing", async () => {
    expect(await careersSiteRoutes(job, deps({ getHtml: async () => { throw new Error("down"); }, getJson: async () => { throw new Error("down"); } }))).toEqual([]);
  });
});

describe("Google for Jobs direct links", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    employer_name: "Cygnify", job_title: "Head of Artificial Intelligence", job_city: "Singapore", job_country: "SG",
    apply_options: [
      { publisher: "LinkedIn", apply_link: "https://www.linkedin.com/jobs/view/123456", is_direct: false },
      { publisher: "Cygnify Careers", apply_link: "https://boards.greenhouse.io/cygnifyhq/jobs/1", is_direct: true },
      { publisher: "Jooble", apply_link: "https://jooble.org/desc/9", is_direct: false },
    ], ...over,
  });
  it("returns the direct employer link first and drops other boards and redirectors", async () => {
    const found = await googleJobsRoutes(job, async () => [row()]);
    expect(found.map((f) => f.url)).toEqual(["https://boards.greenhouse.io/cygnifyhq/jobs/1"]);
    expect(found[0]).toMatchObject({ ats: "greenhouse" });
    expect(found[0].how).toMatch(/direct application link Google for Jobs lists \(Cygnify Careers\)/);
  });
  it("ignores another company's or another role's posting", async () => {
    expect(await googleJobsRoutes(job, async () => [row({ employer_name: "Other Corp" }), row({ job_title: "Office Manager" }), row({ job_city: "Paris", job_country: "FR" })])).toEqual([]);
  });
  it("copes with a failing search and with missing apply options", async () => {
    expect(await googleJobsRoutes(job, async () => { throw new Error("quota"); })).toEqual([]);
    expect(await googleJobsRoutes(job, async () => [row({ apply_options: undefined, job_apply_link: "https://careers.cygnify.com/o/1", job_apply_is_direct: true })])).toEqual([expect.objectContaining({ url: "https://careers.cygnify.com/o/1", ats: "none" })]);
  });
});

import { reachedForm, summariseAttempts, type RouteAttempt } from "@/lib/apply/route-chain";
describe("the record of routes tried", () => {
  const attempts: RouteAttempt[] = [
    { route: "board-link", outcome: "no-link" },
    { route: "description-link", outcome: "none-found" },
    { route: "careers-site", outcome: "unusable", detail: "2 link(s)" },
    { route: "google-jobs", outcome: "error", detail: "no JSearch key" },
  ];
  it("says every route in order, in plain words", () => {
    const text = summariseAttempts(attempts);
    expect(text).toMatch(/^Routes tried \(4\): the job board's own Apply link: had no usable link; a link named in the job description: found nothing for this job; /);
    expect(text).toMatch(/the employer's own careers page: found links but none opened an application form \(2 link\(s\)\)/);
    expect(text).toMatch(/Google for Jobs.*: failed \(no JSearch key\)\.$/);
    expect(reachedForm(attempts)).toBe(false);
    expect(reachedForm([...attempts, { route: "employer-board", outcome: "worked" }])).toBe(true);
    expect(summariseAttempts([])).toBe("");
  });
});
