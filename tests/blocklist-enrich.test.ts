import { describe, expect, it, vi } from "vitest";
import { MasterProfile } from "@/lib/types";
import { blocklistReason, NO_BLOCKLIST, prefilter } from "@/lib/score/prompt";

vi.mock("server-only", () => ({}));
import { checkPostingOpen, extractJobText, fetchJobText, isReadablePage } from "@/lib/jobs/posting";
import type { ResolveDeps } from "@/lib/jobs/resolve-url";

const job = (o: Record<string, unknown> = {}) => ({ title: "Product Manager", company: "Acme Pte Ltd", country: "sg", location: "Singapore", description: "Own the roadmap. ".repeat(20), salary_text: null, ...o }) as never;
const profile = MasterProfile.parse({ basics: { headline: "PM" }, preferences: { countries: ["sg"], roles: ["Product Manager"] }, experience: [{ id: "e", company: "A", title: "PM", bullets: [] }] });

describe("blocklist", () => {
  const b = { companies: ["acme staffing", "Globex"], keywords: ["unpaid", "commission only"], skip_agencies: false };
  it("blocks companies by part of the name, in any letter case", () => {
    expect(blocklistReason(job({ company: "ACME Staffing Pte" }), b)).toMatch(/blocklist/);
    expect(blocklistReason(job({ company: "The Globex Corporation" }), b)).toMatch(/Globex/);
    expect(blocklistReason(job({ company: "Acme Pay" }), b)).toBeNull();
  });
  it("blocks words in the title or the description", () => {
    expect(blocklistReason(job({ description: "This is an UNPAID trial role. " + "x".repeat(200) }), b)).toMatch(/unpaid/);
    expect(blocklistReason(job({ title: "Sales (commission only)" }), b)).toMatch(/commission only/);
  });
  it("skips recruitment agencies only when asked", () => {
    const agency = job({ company: "Prime Recruitment Solutions" });
    expect(blocklistReason(agency, b)).toBeNull();
    expect(blocklistReason(agency, { ...b, skip_agencies: true })).toMatch(/agency/);
    expect(blocklistReason(job({ description: "Our client, a leading bank, is hiring. " + "x".repeat(200) }), { ...b, skip_agencies: true })).toMatch(/agency/);
    expect(blocklistReason(job({ company: "Staffing Needs Inc" }), { ...b, skip_agencies: true })).toMatch(/agency/);
  });
  it("blank entries never match everything", () => {
    expect(blocklistReason(job(), { companies: ["", "  "], keywords: [""], skip_agencies: false })).toBeNull();
  });
  it("is applied first by the prefilter, and an empty blocklist changes nothing", () => {
    expect(prefilter(job({ company: "Globex" }), profile, undefined, b)).toMatch(/blocklist/);
    expect(prefilter(job(), profile, undefined, NO_BLOCKLIST)).toBeNull();
    expect(prefilter(job(), profile)).toBeNull();
  });
});

const html = (body: string, head = "") => `<html><head>${head}</head><body><nav>Menu</nav>${body}<footer>Legal</footer></body></html>`;
const LONG = "Responsibilities: own the roadmap, work with engineering and design, define success metrics and requirements. Qualifications: five years of experience in product management. ".repeat(3);

describe("job page text", () => {
  it("prefers the schema.org JobPosting description", () => {
    const ld = JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", description: `<p>${LONG}</p>` });
    const t = extractJobText(html("<p>cookie banner</p>", `<script type="application/ld+json">${ld}</script>`))!;
    expect(t).toContain("Responsibilities");
    expect(t).not.toContain("cookie banner");
  });
  it("finds a JobPosting inside @graph, and survives broken JSON", () => {
    const ld = JSON.stringify({ "@graph": [{ "@type": "WebSite" }, { "@type": "JobPosting", description: LONG }] });
    expect(extractJobText(html("", `<script type="application/ld+json">{bad json</script><script type="application/ld+json">${ld}</script>`))).toContain("Responsibilities");
  });
  it("falls back to the main content, without navigation, scripts or forms", () => {
    const t = extractJobText(html(`<main><h1>PM</h1><p>${LONG}</p><script>evil()</script><form><label>Name</label></form></main>`))!;
    expect(t).toContain("roadmap");
    expect(t).not.toMatch(/evil|Menu|Legal/);
  });
  it("rejects pages that are not job descriptions", () => {
    expect(extractJobText(html("<p>Short page</p>"))).toBeNull();
    expect(extractJobText(html(`<p>${"Welcome to our shop. We sell shoes and bags. ".repeat(30)}</p>`))).toBeNull();
  });
});

describe("what is read", () => {
  it("never reads job portals", () => {
    for (const u of ["https://www.linkedin.com/jobs/view/1", "https://www.indeed.com/viewjob?jk=1", "https://www.naukri.com/job-listings-x-1", "https://www.bayt.com/en/uae/jobs/x-1/", "https://sg.jobstreet.com/job/1", "https://www.mycareersfuture.gov.sg/job/x"]) expect(isReadablePage(u), u).toBe(false);
    for (const u of ["https://boards.greenhouse.io/acme/jobs/1", "https://careers.acme.com/jobs/1", "https://www.adzuna.sg/land/ad/1"]) expect(isReadablePage(u), u).toBe(true);
    expect(isReadablePage("ftp://x.com/a")).toBe(false);
  });
  const deps = (pages: Record<string, { status: number; body?: string; location?: string }>): ResolveDeps => ({
    lookup: async () => ["93.184.216.34"],
    fetch: async (url) => { const p = pages[url] ?? { status: 404 }; return { status: p.status, headers: { get: (n: string) => (n.toLowerCase() === "location" ? p.location ?? null : null) }, text: async () => p.body ?? "", body: null }; },
  });
  it("fetchJobText follows an aggregator redirect to the employer page and returns its text", async () => {
    const d = deps({ "https://www.adzuna.sg/land/ad/1": { status: 302, location: "https://careers.acme.com/job/1" }, "https://careers.acme.com/job/1": { status: 200, body: html(`<main>${LONG}</main>`) } });
    expect(await fetchJobText("https://www.adzuna.sg/land/ad/1", d)).toContain("Responsibilities");
  });
  it("never follows a redirect onto a job portal or an internal address", async () => {
    const toPortal = deps({ "https://www.adzuna.sg/land/ad/2": { status: 302, location: "https://www.linkedin.com/jobs/view/9" }, "https://www.linkedin.com/jobs/view/9": { status: 200, body: html(`<main>${LONG}</main>`) } });
    expect(await fetchJobText("https://www.adzuna.sg/land/ad/2", toPortal)).toBeNull();
    const internal = deps({ "https://x.example/a": { status: 302, location: "http://169.254.169.254/" } });
    expect(await fetchJobText("https://x.example/a", internal)).toBeNull();
  });
});

describe("is the posting still open", () => {
  const deps = (status: number, body = ""): ResolveDeps => ({ lookup: async () => ["93.184.216.34"], fetch: async () => ({ status, headers: { get: () => null }, text: async () => body, body: null }) });
  it("a removed page is closed", async () => {
    expect(await checkPostingOpen("https://careers.acme.com/job/1", deps(404))).toMatchObject({ open: false });
    expect(await checkPostingOpen("https://careers.acme.com/job/1", deps(410))).toMatchObject({ open: false });
  });
  it("a page that says it is closed is closed", async () => {
    expect(await checkPostingOpen("https://careers.acme.com/job/1", deps(200, html("<h1>Sorry, this job is no longer available.</h1>")))).toMatchObject({ open: false });
    expect(await checkPostingOpen("https://careers.acme.com/job/1", deps(200, html("<p>The position has been filled.</p>")))).toMatchObject({ open: false });
  });
  it("a normal job page is open, even a long one that mentions closing somewhere", async () => {
    expect(await checkPostingOpen("https://careers.acme.com/job/1", deps(200, html(`<main>${LONG}</main>`)))).toEqual({ open: true });
    expect(await checkPostingOpen("https://careers.acme.com/job/1", deps(200, html(`<main>${LONG.repeat(4)} We're no longer using spreadsheets.</main>`)))).toEqual({ open: true });
  });
  it("cannot tell for portals or on errors, which never blocks anything", async () => {
    expect(await checkPostingOpen("https://www.linkedin.com/jobs/view/1", deps(404))).toEqual({ open: null });
    expect(await checkPostingOpen("https://careers.acme.com/job/1", deps(503))).toEqual({ open: null });
    expect(await checkPostingOpen("https://careers.acme.com/job/1", { lookup: async () => { throw new Error("dns"); }, fetch: async () => { throw new Error("x"); } })).toEqual({ open: null });
  });
});
