import { describe, expect, it } from "vitest";
import { digestText, summarize, type ReportRow } from "@/lib/reports";

const row = (o: Partial<ReportRow>): ReportRow => ({
  country: "in", source: "adzuna:in:PM", apply_type: "portal", status: "submitted", lifecycle: "applied",
  submitted_at: "2026-10-14T00:00:00Z", score: 70, gaps: [], ...o,
});

describe("summarize", () => {
  const rows = [
    row({ lifecycle: "interview", score: 90, gaps: ["SQL"] }),
    row({ lifecycle: "rejected", score: 60, gaps: ["sql ", "Go"], country: "sg" }),
    row({ lifecycle: "applied", score: 70 }),
    row({ status: "failed", submitted_at: null }),
    row({ submitted_at: "2026-09-01T00:00:00Z" }), // outside window
  ];
  const s = summarize(rows, new Date("2026-10-09T00:00:00Z"));
  it("counts and rates only submitted rows in the window", () => {
    expect(s.submitted).toBe(3);
    expect(s.responded).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.responseRate).toBe(33);
    expect(s.avgFitSubmitted).toBe(73);
    expect(s.avgFitResponded).toBe(90);
  });
  it("groups by country and source and normalises gap spelling", () => {
    expect(s.byCountry).toEqual([{ name: "IN", count: 2 }, { name: "SG", count: 1 }]);
    expect(s.bySource).toEqual([{ name: "adzuna", count: 3 }]);
    expect(s.commonGaps[0]).toEqual({ name: "sql", count: 2 });
  });
  it("handles empty data without dividing by zero", () => {
    expect(summarize([])).toMatchObject({ submitted: 0, responseRate: null, avgFitSubmitted: null });
  });
});

describe("digestText", () => {
  it("renders a readable digest", () => {
    const t = digestText({ fresh: 2, queued: 5, prepared: 1, sent7: 4, failed: 0 }, "https://x.vercel.app");
    expect(t).toContain("Matched and waiting for your review: 5");
    expect(t).toContain("Nothing needs attention");
    expect(t).toContain("https://x.vercel.app/jobs");
  });
});
