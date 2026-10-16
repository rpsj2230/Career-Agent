import { describe, expect, it } from "vitest";
import { buildDailyReport, validDate, type DailyReportInput } from "@/lib/daily-report";

const j = (id: string, o = {}) => ({ id, title: `Role ${id}`, company: `Co ${id}`, country: "sg", portal: "linkedin", ...o });
const a = (id: string, o = {}) => ({ id, title: `Role ${id}`, company: `Co ${id}`, country: "sg", portal: "greenhouse", ...o });
const empty: DailyReportInput = { date: "2026-10-16", timezone: "Asia/Kolkata", found: [], matched: [], rejected: [], prepared: [], submitted: [], awaiting: [], manual: [], failed: [], scanErrors: [], failedRuns: [] };

describe("buildDailyReport", () => {
  it("counts everything and splits automatic submissions", () => {
    const r = buildDailyReport({ ...empty, found: [j("1"), j("2")], matched: [j("1")], rejected: [j("2", { skip_reason: "Fit 40 below threshold 65" })], prepared: [a("3")], submitted: [a("3", { method: "automated" }), a("4", { method: "assisted" })], awaiting: [a("5")], manual: [a("6")], failed: [a("7", { error: "CAPTCHA" })] });
    expect(r.summary).toEqual({ found: 2, matched: 1, rejected: 1, prepared: 1, submitted: 2, submittedAuto: 1, awaiting: 1, manual: 1, failed: 1, problems: 0 });
  });

  it("links every item to its job or application page", () => {
    const r = buildDailyReport({ ...empty, matched: [j("m1")], submitted: [a("s1")], failed: [a("f1", { error: "x" })] });
    expect(r.items.find((x) => x.section === "matched")?.href).toBe("/jobs/m1");
    expect(r.items.find((x) => x.section === "submitted")?.href).toBe("/applications/s1");
    expect(r.items.find((x) => x.section === "failed")).toMatchObject({ href: "/applications/f1", detail: "x" });
  });

  it("gives rejections their reason and failures a reason even when none was stored", () => {
    const r = buildDailyReport({ ...empty, rejected: [j("1", { skip_reason: "Country US is outside your target countries" })], failed: [a("2")] });
    expect(r.items.find((x) => x.section === "rejected")?.detail).toMatch(/outside your target/);
    expect(r.items.find((x) => x.section === "failed")?.detail).toBe("No reason was recorded");
  });

  it("puts what needs you first, and source problems with links to the portals and runs", () => {
    const r = buildDailyReport({ ...empty, found: [j("1")], failed: [a("2", { error: "e" })], scanErrors: [{ integration: "jsearch", error: "quota" }], failedRuns: [{ id: "r1", kind: "pipeline", error: "db down" }] });
    expect(r.items.map((x) => x.section)).toEqual(["failed", "found", "problems", "problems"]);
    expect(r.items.filter((x) => x.section === "problems").map((x) => x.href)).toEqual(["/portals", "/logs/runs/r1"]);
    expect(r.summary.problems).toBe(2);
  });

  it("writes a plain-text body with absolute links when the app address is known, and relative ones otherwise", () => {
    const base = { ...empty, submitted: [a("s1", { method: "automated" })] };
    expect(buildDailyReport(base, "https://app.example/").body).toContain("https://app.example/applications/s1");
    expect(buildDailyReport(base, "https://app.example/").body).toContain("https://app.example/reports/daily/2026-10-16");
    expect(buildDailyReport(base).body).toContain("\n  /applications/s1");
  });

  it("keeps the message short but says how many more there are and where to read them", () => {
    const many = Array.from({ length: 20 }, (_, n) => a(String(n), { error: "e" }));
    const r = buildDailyReport({ ...empty, failed: many }, "https://x.app");
    expect(r.body).toContain("...and 14 more: https://x.app/reports/daily/2026-10-16");
    expect(r.items.filter((x) => x.section === "failed").length).toBe(20);
    expect(r.body.length).toBeLessThan(3900);
  });

  it("caps stored items per section and reports which were cut", () => {
    const r = buildDailyReport({ ...empty, found: Array.from({ length: 120 }, (_, n) => j(String(n))) });
    expect(r.items.length).toBe(50);
    expect(r.truncated).toEqual(["found"]);
    expect(r.summary.found).toBe(120);
  });

  it("an empty day is a valid report", () => {
    const r = buildDailyReport(empty);
    expect(r.items).toEqual([]);
    expect(r.body).toContain("Found 0");
  });
});

describe("validDate", () => {
  it("accepts real dates only", () => {
    expect(validDate("2026-10-16")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "16-10-2026", "2026-10-1", "", undefined, "2026-10-16T00:00"]) expect(validDate(bad)).toBe(false);
  });
});
