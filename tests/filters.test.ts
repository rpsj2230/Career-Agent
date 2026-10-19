import { describe, expect, it } from "vitest";
import { APP_STATUS_LABEL, countryLabel, safeSearch } from "@/lib/filters";
import { jobStage, parseJobQuery, STAGES } from "@/lib/list-query";

describe("search text", () => {
  it("strips characters that would change a PostgREST filter", () => {
    expect(safeSearch('a,b)or(c.eq.1 "x" 100% _ \\')).toBe("a b or c.eq.1 x 100");
    expect(safeSearch("x".repeat(200))).toHaveLength(80);
    expect(parseJobQuery({ q: "),id.neq.0,(" }).q).toBe("id.neq.0");
  });
});

describe("status model", () => {
  it("names every stored application status and puts every job and application status in a stage", () => {
    for (const s of ["prepared", "approved", "submitting", "submitted", "assisted_pending", "needs_input", "failed"]) expect(APP_STATUS_LABEL[s], s).toBeTruthy();
    expect(APP_STATUS_LABEL.prepared).toBe("Pending approval");
    expect(APP_STATUS_LABEL.needs_input).toBe("Needs your input");
    expect(APP_STATUS_LABEL.assisted_pending).toBe("Waiting for assistant / you");
    for (const j of ["new", "queued", "skipped", "saved", "prepared", "applied"]) expect(STAGES[jobStage(j, j === "prepared" ? "prepared" : null)], j).toBeTruthy();
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
