import { describe, expect, it } from "vitest";
import { APP_STATUS_LABEL, APP_STATUSES, countryLabel, JOB_VIEWS, parseAppFilters, parseJobFilters, safeSearch } from "@/lib/filters";

describe("parseJobFilters", () => {
  it("defaults to the review queue with no filters", () => expect(parseJobFilters({})).toEqual({ view: "queue", portal: undefined, country: undefined, q: undefined }));
  it("accepts valid values and lower-cases portal and country", () => {
    expect(parseJobFilters({ view: "skipped", portal: "LinkedIn", country: "SG", q: " product manager " })).toEqual({ view: "skipped", portal: "linkedin", country: "sg", q: "product manager" });
  });
  it("drops unknown views and malformed portal/country values instead of passing them to the database", () => {
    const f = parseJobFilters({ view: "drop table", portal: "x'; delete", country: "singapore", q: "" });
    expect(f).toEqual({ view: "queue", portal: undefined, country: undefined, q: undefined });
    expect(parseJobFilters({ portal: ["linkedin", "indeed"] }).portal).toBe("linkedin");
  });
  it("strips characters that would change a PostgREST filter", () => {
    expect(safeSearch('a,b)or(c.eq.1 "x" 100% _ \\')).toBe("a b or c.eq.1 x 100");
    expect(safeSearch("x".repeat(200))).toHaveLength(80);
    expect(parseJobFilters({ q: "),id.neq.0,(" }).q).toBe("id.neq.0");
  });
  it("has a view for every status a job can have", () => {
    const covered = new Set(Object.values(JOB_VIEWS).flatMap((v) => v.statuses ?? []));
    for (const s of ["new", "queued", "skipped", "saved", "prepared", "applied"]) expect(covered.has(s), s).toBe(true);
  });
});

describe("application status model", () => {
  it("covers every stored status under the four names the user asked for", () => {
    const stored = ["prepared", "approved", "submitting", "submitted", "assisted_pending", "needs_input", "failed"];
    const grouped = new Set(Object.values(APP_STATUSES).flatMap((v) => v.statuses ?? []));
    for (const s of stored) { expect(grouped.has(s), s).toBe(true); expect(APP_STATUS_LABEL[s], s).toBeTruthy(); }
    expect(APP_STATUS_LABEL.prepared).toBe("Pending approval");
    expect(APP_STATUS_LABEL.needs_input).toBe("Requires manual action");
    expect(APP_STATUS_LABEL.assisted_pending).toBe("Requires manual action");
  });
  it("parses application filters with the same safety", () => {
    expect(parseAppFilters({ status: "failed", portal: "naukri", country: "in" })).toEqual({ status: "failed", portal: "naukri", country: "in", q: undefined });
    expect(parseAppFilters({ status: "bogus" }).status).toBe("all");
  });
});

describe("countryLabel", () => {
  it("names known countries and upper-cases unknown ones", () => {
    expect(countryLabel("sg")).toBe("Singapore");
    expect(countryLabel("AU")).toBe("Australia");
    expect(countryLabel("zz")).toBe("ZZ");
    expect(countryLabel(null)).toBe("Unknown");
  });
});
