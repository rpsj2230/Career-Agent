import { describe, expect, it } from "vitest";
import { applyReport, bySource, runSentence, windowLabel } from "@/lib/run-report";
import { runScans } from "@/lib/jobs/scans";

describe("scan window", () => {
  it("labels the posting dates a scan asked for", () => {
    expect(windowLabel({ window_from: "2026-01-01T05:00:00Z", window_to: "2026-01-03T05:00:00Z" }, "UTC")).toMatch(/1.*to.*3/);
    expect(windowLabel({}, "UTC")).toBeNull();
  });
  it("records the window on each scan", async () => {
    const seen: unknown[] = [];
    const now = Date.parse("2026-01-03T00:00:00Z");
    await runScans([{ integration: "remotive", query: "pm", windowDays: 2, fetch: async () => [] }], {
      startScan: async () => "s1", finishScan: async (_i, _m, r) => { seen.push(r.detail); },
      ingest: async () => ({ inserted: 0, duplicates: 0, stale: 0, invalid: 0 }), recordIntegration: async () => undefined, now: () => now,
    });
    expect(seen[0]).toMatchObject({ window_days: 2, window_to: "2026-01-03T00:00:00.000Z", window_from: "2026-01-01T00:00:00.000Z" });
  });
});

describe("run sentence", () => {
  const scans = [
    { integration: "remotive", country: null, query: "pm", status: "ok", fetched: 20, inserted: 5, duplicates: 15, stale: 0, invalid: 0, error: null, detail: { window_from: "2026-01-01T00:00:00Z", window_to: "2026-01-03T00:00:00Z" } },
    { integration: "remotive", country: null, query: "ops", status: "error", fetched: 0, inserted: 0, duplicates: 0, stale: 0, invalid: 0, error: "x", detail: null },
    { integration: "adzuna", country: "in", query: "pm", status: "ok", fetched: 13, inserted: 4, duplicates: 9, stale: 2, invalid: 0, error: null, detail: null },
  ];
  it("groups by source", () => {
    const s = bySource(scans, (x) => x.toUpperCase(), "UTC");
    expect(s[0]).toMatchObject({ source: "REMOTIVE", scans: 2, failed: 1, fetched: 20, inserted: 5 });
    expect(s[0].window).toBeTruthy();
  });
  it("reads as a sentence", () => {
    const t = runSentence({ inserted: 9, duplicates: 24, stale: 2, rejected_by_rules: 3, scored: 6, rejected: 3, prepared: 3, auto_approved: 2, manual_required: 1 }, bySource(scans, (x) => x));
    expect(t).toBe("Fetched 33 jobs from 2 sources (9 new, 24 already known, 2 too old); 3 skipped by your rules; 6 scored (3 below your threshold); 3 prepared; 2 approved automatically; 1 need you to apply.");
    expect(runSentence({}, [])).toBe("Nothing was recorded for this run.");
  });
});

describe("apply report", () => {
  it("counts by method, approver, portal and country", () => {
    const r = applyReport([
      { kind: "application.submitted", portal: "greenhouse", country: "sg", status: "submitted", detail: { method: "automated" } },
      { kind: "application.submitted", portal: "linkedin", country: "in", status: "submitted", detail: { method: "assisted" } },
      { kind: "application.approved", portal: "greenhouse", country: "sg", status: "approved", detail: { actor: "schedule" } },
      { kind: "application.approved", portal: "linkedin", country: "in", status: "approved", detail: { actor: "user" } },
      { kind: "application.needs_input", portal: "linkedin", country: "in", status: "needs_input", detail: null },
      { kind: "application.failed", portal: "lever", country: null, status: "failed", detail: null },
    ]);
    expect(r).toMatchObject({ submitted: 2, byScheduleApproved: 1, byYouApproved: 1, needsYou: 1, failed: 1, byMethod: { automated: 1, assisted: 1 } });
    expect(r.byPortal.find((x) => x.key === "linkedin")).toMatchObject({ submitted: 1, needsYou: 1 });
    expect(r.byCountry.find((x) => x.key === "Unknown")?.failed).toBe(1);
  });
});
