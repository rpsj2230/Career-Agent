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
