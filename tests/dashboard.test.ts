import { describe, expect, it } from "vitest";
import { parsePeriod, periodStart, summariseDashboard, type DashApp, type DashInput, type DashJob } from "@/lib/dashboard";

const from = new Date("2026-10-10T00:00:00Z");
const day = (d: number, h = 12) => `2026-10-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00Z`;
const job = (o: Partial<DashJob>): DashJob => ({ country: "sg", portal: "linkedin", status: "queued", found_at: day(12), decided_at: day(12), ...o });
const app = (o: Partial<DashApp>): DashApp => ({ id: "a", status: "prepared", method: null, created_at: day(12), submitted_at: null, error: null, country: "sg", portal: "linkedin", title: "PM", company: "Acme", ...o });
const input = (o: Partial<DashInput>): DashInput => ({ from, jobs: [], decided: [], apps: [], docs: 0, scans: [], runs: [], ...o });

describe("periodStart", () => {
  const now = new Date("2026-10-16T20:00:00Z"); // 17 Oct 01:30 in Kolkata
  it("starts today at local midnight", () => expect(periodStart("today", now, "Asia/Kolkata").toISOString()).toBe("2026-10-16T18:30:00.000Z"));
  it("7d includes today and the six days before", () => expect(periodStart("7d", now, "Asia/Kolkata").toISOString()).toBe("2026-10-10T18:30:00.000Z"));
  it("30d covers 30 local days", () => expect(periodStart("30d", now, "UTC").toISOString()).toBe("2026-09-17T00:00:00.000Z"));
  it("falls back to 7 days for unknown input", () => { expect(parsePeriod("x")).toBe("7d"); expect(parsePeriod("today")).toBe("today"); });
});

describe("summariseDashboard", () => {
  it("counts only what happened inside the period", () => {
    const s = summariseDashboard(input({
      jobs: [job({}), job({ found_at: day(5) })],
      decided: [job({ status: "queued" }), job({ status: "skipped" }), job({ status: "queued", decided_at: day(5) })],
      apps: [app({ created_at: day(12) }), app({ created_at: day(3), id: "old" })],
      docs: 6,
    }));
    expect(s.period).toMatchObject({ found: 1, matched: 1, rejected: 1, prepared: 1, documents: 6, submitted: 0 });
  });

  it("splits submissions into automatic and by you", () => {
    const s = summariseDashboard(input({ apps: [
      app({ id: "1", status: "submitted", method: "automated", submitted_at: day(12) }),
      app({ id: "2", status: "submitted", method: "assisted", submitted_at: day(13) }),
      app({ id: "3", status: "submitted", method: "assisted", submitted_at: day(2) }),
    ] }));
    expect(s.period).toMatchObject({ submitted: 2, submittedAuto: 1, submittedManual: 1 });
  });

  it("reports the current backlog regardless of period", () => {
    const s = summariseDashboard(input({ apps: [
      app({ id: "1", status: "prepared", created_at: day(1) }), app({ id: "2", status: "assisted_pending" }), app({ id: "3", status: "needs_input" }),
      app({ id: "4", status: "failed", error: "boom" }), app({ id: "5", status: "approved" }), app({ id: "6", status: "submitting" }),
    ] }));
    expect(s.now).toEqual({ awaiting: 1, manual: 2, failed: 1, inProgress: 2 });
  });

  it("explains problems with their reasons: applications, scans and runs", () => {
    const s = summariseDashboard(input({
      apps: [app({ id: "x", status: "failed", error: "Page requires a CAPTCHA" }), app({ id: "y", status: "needs_input", error: null })],
      scans: [{ integration: "jsearch", country: "sg", status: "error", started_at: day(12), fetched: 0, inserted: 0, duplicates: 0, error: "quota exceeded" }],
      runs: [{ id: "r1", kind: "pipeline", status: "failed", started_at: day(12), finished_at: null, error: "database down", stats: {} }],
    }));
    expect(s.problems.map((p) => [p.kind, p.reason])).toEqual([
      ["application", "Page requires a CAPTCHA"], ["application", "Needs your input"], ["scan", "quota exceeded"], ["run", "database down"],
    ]);
  });

  it("describes a prepared-for-manual-submit application as waiting for you, not as a failure", () => {
    const s = summariseDashboard(input({ apps: [app({ status: "assisted_pending" })] }));
    expect(s.problems[0].reason).toMatch(/waiting for you to press the final submit/);
  });

  it("breaks results down by country and portal, most active first, with unknowns kept", () => {
    const s = summariseDashboard(input({
      jobs: [job({ country: "sg", portal: "linkedin" }), job({ country: "sg", portal: "indeed" }), job({ country: "in", portal: null })],
      apps: [app({ id: "1", status: "submitted", method: "automated", submitted_at: day(12), country: "in", portal: "naukri" })],
    }));
    expect(s.byCountry.map((r) => [r.key, r.found, r.submitted])).toEqual([["in", 1, 1], ["sg", 2, 0]]);
    expect(s.byPortal.find((r) => r.key === "unknown")?.found).toBe(1);
    expect(s.byPortal.find((r) => r.key === "naukri")?.submitted).toBe(1);
  });

  it("sums scan activity in the period", () => {
    const sc = (o = {}) => ({ integration: "adzuna", country: "sg", status: "ok", started_at: day(12), fetched: 30, inserted: 5, duplicates: 20, error: null, ...o });
    const s = summariseDashboard(input({ scans: [sc(), sc(), sc({ started_at: day(1) })] }));
    expect(s.period).toMatchObject({ scans: 2, jobsFetched: 60, duplicates: 40 });
  });

  it("is all zeros on an empty database", () => {
    const s = summariseDashboard(input({}));
    expect(s.period.found).toBe(0); expect(s.problems).toEqual([]); expect(s.byCountry).toEqual([]);
  });
});
