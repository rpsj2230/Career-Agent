import { mapArbeitnow, mapJobicy, mapRemoteOk } from "@/lib/jobs/map";
import { describe, expect, it } from "vitest";
import { dedupeKey, detectApplyType, guessCountry, htmlToText } from "@/lib/jobs/normalize";
import { mapAdzuna, mapGreenhouse, mapJSearch, mapLever, mapRemotive } from "@/lib/jobs/map";

describe("normalize", () => {
  it("detects apply types", () => {
    expect(detectApplyType("https://boards.greenhouse.io/acme/jobs/1")).toBe("greenhouse");
    expect(detectApplyType("https://jobs.lever.co/acme/abc")).toBe("lever");
    expect(detectApplyType("https://www.linkedin.com/jobs/view/1")).toBe("linkedin");
    expect(detectApplyType("https://www.naukri.com/job-listings-x")).toBe("portal");
    expect(detectApplyType("https://acme.com/careers/1")).toBe("unknown");
    expect(detectApplyType("not a url")).toBe("unknown");
  });
  it("dedupes across sources and company suffixes", () => {
    expect(dedupeKey("Acme Pvt. Ltd.", "Senior  Product Manager", "IN")).toBe(dedupeKey("ACME", "senior product manager!", "in"));
    expect(dedupeKey("Acme", "PM", "in")).not.toBe(dedupeKey("Acme", "PM", "us"));
  });
  it("strips escaped html", () => {
    expect(htmlToText("&lt;p&gt;Hello &amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;")).toBe("Hello & welcome\n- One");
  });
  it("guesses country", () => {
    expect(guessCountry("Bengaluru, India")).toBe("in");
    expect(guessCountry("Remote")).toBeUndefined();
  });
});

describe("mappers", () => {
  it("maps adzuna", () => {
    const j = mapAdzuna({ id: 9, title: "PM", company: { display_name: "Acme" }, location: { display_name: "Pune" }, redirect_url: "https://x", description: "d", salary_min: 1000000, salary_max: 1500000.4, created: "2026-10-01T00:00:00Z" }, "in");
    expect(j).toMatchObject({ source: "adzuna", externalId: "9", country: "in", salaryText: "INR 1000000 - 1500000" });
  });
  it("keeps structured pay, marks Adzuna estimates, and converts JSearch periods", () => {
    const a = mapAdzuna({ id: 1, title: "PM", company: { display_name: "A" }, location: { display_name: "x" }, redirect_url: "https://x", description: "d", salary_min: 90000, salary_max: 110000, salary_is_predicted: "1" }, "sg");
    expect(a.salary).toEqual({ min: 90000, max: 110000, currency: "SGD", period: "year", estimated: true });
    expect(a.salaryText).toBe("SGD 90000 - 110000 (estimated)");
    expect(mapAdzuna({ id: 2, title: "PM", company: {}, redirect_url: "https://x", description: "d" }, "sg").salary).toBeUndefined();
    const j = mapJSearch({ job_id: "a", job_title: "PM", employer_name: "A", job_country: "SG", job_apply_link: "https://x", job_description: "d", job_min_salary: 8000, job_max_salary: 10000, job_salary_currency: "SGD", job_salary_period: "MONTH" });
    expect(j.salary).toEqual({ min: 8000, max: 10000, currency: "SGD", period: "month" });
  });
  it("maps jsearch with 2-letter country", () => {
    expect(mapJSearch({ job_id: "a", job_title: "PM", employer_name: "Acme", job_country: "IN", job_city: "Delhi", job_apply_link: "https://x", job_description: "d" }).country).toBe("in");
  });
  it("maps remotive, greenhouse and lever", () => {
    expect(mapRemotive({ id: 1, title: "t", company_name: "c", url: "u", description: "<p>x</p>", candidate_required_location: "Worldwide" }).description).toBe("x");
    expect(mapGreenhouse({ id: 2, title: "t", absolute_url: "u", location: { name: "Mumbai, India" }, content: "&lt;p&gt;y&lt;/p&gt;" }, "acme")).toMatchObject({ company: "acme", country: "in", description: "y" });
    expect(mapLever({ id: "z", text: "t", hostedUrl: "u", categories: { location: "Singapore" }, descriptionPlain: "p", createdAt: 1760000000000 }, "acme")).toMatchObject({ country: "sg", description: "p" });
  });
});

describe("free feeds: Arbeitnow, Remote OK, Jobicy", () => {
  it("maps Arbeitnow, using the feed's unix timestamps and defaulting an on-site Europe job to Germany", () => {
    const j = mapArbeitnow({ slug: "pm-acme-berlin-1", title: "Product Manager", company_name: "Acme GmbH", description: "<p>Own the roadmap</p>", location: "Berlin", remote: false, url: "https://www.arbeitnow.com/view/pm-acme-berlin-1", created_at: 1760000000 });
    expect(j).toMatchObject({ source: "arbeitnow", externalId: "pm-acme-berlin-1", company: "Acme GmbH", location: "Berlin", country: "de", description: "Own the roadmap" });
    expect(j.postedAt).toBe(new Date(1760000000 * 1000).toISOString());
    expect(mapArbeitnow({ slug: "r", title: "PM", company_name: "X", location: "", remote: true, url: "https://x", created_at: 1 }).country).toBeUndefined();
  });
  it("maps Remote OK with USD salary", () => {
    const j = mapRemoteOk({ id: "9001", position: "Senior Product Manager", company: "Beta", location: "Worldwide", description: "<p>x</p>", url: "https://remoteok.com/remote-jobs/9001", date: "2026-10-10T00:00:00+00:00", salary_min: 120000, salary_max: 150000 });
    expect(j).toMatchObject({ source: "remoteok", externalId: "9001", title: "Senior Product Manager", salary: { min: 120000, max: 150000, currency: "USD", period: "year" } });
    expect(j.salaryText).toBe("USD 120000 - 150000");
    expect(mapRemoteOk({ id: 1, position: "PM", company: "B", url: "https://x" }).salary).toBeUndefined();
  });
  it("maps Jobicy including its currency and decoding HTML entities in titles", () => {
    const j = mapJobicy({ id: 77, url: "https://jobicy.com/jobs/77", jobTitle: "Product Manager &amp; Owner", companyName: "Gamma", jobGeo: "Singapore", jobDescription: "<p>desc</p>", pubDate: "2026-10-09 10:00:00", annualSalaryMin: "90000", annualSalaryMax: "110000", salaryCurrency: "SGD" });
    expect(j).toMatchObject({ source: "jobicy", title: "Product Manager & Owner", country: "sg", salary: { min: 90000, max: 110000, currency: "SGD" } });
    expect(mapJobicy({ id: 1, url: "https://x", jobTitle: "PM", companyName: "G", salaryCurrency: "dollars" }).salary).toBeUndefined();
  });
});
