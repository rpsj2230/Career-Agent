import { dedupeKey } from "@/lib/jobs/normalize";
import { describe, expect, it } from "vitest";
import { planInsert } from "@/lib/jobs/plan";
import type { NormalizedJob } from "@/lib/jobs/normalize";

const now = new Date("2026-10-16T00:00:00Z");
const job = (o: Partial<NormalizedJob>): NormalizedJob => ({
  source: "adzuna", externalId: "1", title: "Product Manager", company: "Acme", country: "in",
  url: "https://www.naukri.com/j/1", description: "d", postedAt: "2026-10-10T00:00:00Z", ...o,
});

describe("planInsert", () => {
  it("drops invalid, stale and duplicate jobs and sets apply type", () => {
    const plan = planInsert([
      job({}),
      job({ source: "jsearch", externalId: "2", company: "ACME Pvt Ltd", title: "product manager" }), // cross-source duplicate
      job({ externalId: "3", title: "", url: "https://x" }),                                          // invalid
      job({ externalId: "4", title: "Old role", postedAt: "2026-01-01T00:00:00Z" }),                    // stale
      job({ externalId: "5", title: "Designer", url: "https://boards.greenhouse.io/a/jobs/5" }),
    ], new Set(), 14, now);
    expect(plan.rows.map((r) => r.title)).toEqual(["Product Manager", "Designer"]);
    expect(plan.rows[0].apply_type).toBe("portal");
    expect(plan.rows[1].apply_type).toBe("greenhouse");
    expect({ invalid: plan.invalid, stale: plan.stale, duplicates: plan.duplicates }).toEqual({ invalid: 1, stale: 1, duplicates: 1 });
  });
  it("skips jobs already stored", () => {
    const first = planInsert([job({})], new Set(), 14, now).rows[0].dedupe_key;
    expect(planInsert([job({})], new Set([first]), 14, now).rows).toHaveLength(0);
  });
});

describe("salary on inserted rows", () => {
  const now2 = new Date("2026-10-16T00:00:00Z");
  const j = (o: Partial<NormalizedJob>): NormalizedJob => ({ source: "x", externalId: "1", title: "PM", company: "Acme", country: "sg", url: "https://x.com/1", description: "d", postedAt: "2026-10-10T00:00:00Z", ...o });
  it("annualises structured pay and keeps the estimate flag", () => {
    const r = planInsert([j({ salary: { min: 8000, max: 10000, currency: "SGD", period: "month", estimated: true } })], new Set(), 14, now2).rows[0];
    expect(r).toMatchObject({ salary_min: 96000, salary_max: 120000, salary_currency: "SGD", salary_estimated: true });
  });
  it("parses free-text pay with the country's currency as the fallback", () => {
    const r = planInsert([j({ country: "in", salaryText: "24-32 LPA", externalId: "2", company: "B" })], new Set(), 14, now2).rows[0];
    expect(r).toMatchObject({ salary_min: 2_400_000, salary_max: 3_200_000, salary_currency: "INR", salary_estimated: false });
  });
  it("stores nulls when there is no usable pay", () => {
    const r = planInsert([j({ salaryText: "Competitive", externalId: "3", company: "C" })], new Set(), 14, now2).rows[0];
    expect(r).toMatchObject({ salary_min: null, salary_max: null, salary_currency: null });
  });
});

describe("cross-portal duplicates", () => {
  const now3 = new Date("2026-10-16T00:00:00Z");
  const mk = (o: Partial<NormalizedJob>): NormalizedJob => ({ source: "jsearch:sg:PM", externalId: "a", title: "Product Manager", company: "Acme", country: "sg", url: "https://www.linkedin.com/jobs/view/1", description: "d", postedAt: "2026-10-10T00:00:00Z", ...o });
  const key = dedupeKey("Acme", "Product Manager", "sg");

  it("merges the same role found on two portals in one batch and remembers the second portal", () => {
    const plan = planInsert([mk({}), mk({ externalId: "b", url: "https://sg.indeed.com/viewjob?jk=2" })], new Set(), 14, now3);
    expect(plan.rows.length).toBe(1);
    expect(plan.rows[0]).toMatchObject({ portal: "linkedin", seen_on: ["indeed"] });
    expect(plan.duplicates).toBe(1);
  });
  it("does not list the primary portal as 'also seen on', nor repeat a portal", () => {
    const plan = planInsert([mk({}), mk({ externalId: "b" }), mk({ externalId: "c", url: "https://sg.indeed.com/viewjob?jk=3" }), mk({ externalId: "d", url: "https://sg.indeed.com/viewjob?jk=4" })], new Set(), 14, now3);
    expect(plan.rows[0].seen_on).toEqual(["indeed"]);
  });
  it("reports a stored job found on a different portal as a sighting, once", () => {
    const known = new Map([[key, { id: "job-1", portal: "adzuna", seen_on: [] as string[] }]]);
    const plan = planInsert([mk({}), mk({ externalId: "z" })], new Set([key]), 14, now3, known);
    expect(plan.rows).toEqual([]);
    expect(plan.sightings).toEqual([expect.objectContaining({ jobId: "job-1", portal: "linkedin", primaryPortal: "adzuna", title: "Product Manager", company: "Acme" })]);
  });
  it("records nothing for a stored job whose own portal is unknown", () => {
    const unknown = new Map([[key, { id: "j", portal: null, seen_on: [] as string[] }]]);
    expect(planInsert([mk({})], new Set([key]), 14, now3, unknown).sightings).toEqual([]);
  });
  it("ignores a re-fetch from the same portal and portals already recorded", () => {
    const same = new Map([[key, { id: "j", portal: "linkedin", seen_on: [] as string[] }]]);
    expect(planInsert([mk({})], new Set([key]), 14, now3, same).sightings).toEqual([]);
    const recorded = new Map([[key, { id: "j", portal: "adzuna", seen_on: ["linkedin"] }]]);
    expect(planInsert([mk({})], new Set([key]), 14, now3, recorded).sightings).toEqual([]);
  });
});
