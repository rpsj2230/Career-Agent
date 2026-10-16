import { describe, expect, it } from "vitest";
import { staleAlerts, transitionAlert, type HealthRow } from "@/lib/integrations/health";

describe("transitionAlert", () => {
  it("alerts when a working source starts failing, with the reason", () => {
    expect(transitionAlert("ok", false, "Adzuna", "rejected the credentials (HTTP 401)")).toMatch(/Adzuna stopped working: rejected the credentials/);
    expect(transitionAlert("unknown", false, "Adzuna", "x")).toMatch(/stopped working/);
    expect(transitionAlert(undefined, false, "Adzuna")).toMatch(/scan failed/);
  });
  it("stays quiet while it keeps failing, and when it keeps working", () => {
    expect(transitionAlert("error", false, "Adzuna", "x")).toBeNull();
    expect(transitionAlert("ok", true, "Adzuna")).toBeNull();
    expect(transitionAlert("unknown", true, "Adzuna")).toBeNull();
  });
  it("says when it recovers", () => expect(transitionAlert("error", true, "Adzuna")).toBe("Adzuna is working again."));
  it("truncates a huge error", () => expect(transitionAlert("ok", false, "A", "x".repeat(5000))!.length).toBeLessThan(400));
});

describe("staleAlerts", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const row = (o: Partial<HealthRow>): HealthRow => ({ id: "adzuna", name: "Adzuna", enabled: true, ready: true, last_scan_at: "2026-10-15T00:00:00Z", last_ok_at: "2026-10-15T00:00:00Z", stale_alerted_at: null, ...o });
  it("reports a source with no successful scan for 3+ days", () => {
    expect(staleAlerts([row({ last_ok_at: "2026-10-12T00:00:00Z" })], now)).toEqual([{ id: "adzuna", message: expect.stringMatching(/has not completed a successful scan for 4 days/) }]);
  });
  it("ignores healthy, disabled and not-yet-set-up sources", () => {
    expect(staleAlerts([row({}), row({ enabled: false, last_ok_at: "2026-09-01T00:00:00Z" }), row({ ready: false, last_ok_at: "2026-09-01T00:00:00Z" })], now)).toEqual([]);
  });
  it("reminds at most once a day", () => {
    const stale = row({ last_ok_at: "2026-10-01T00:00:00Z" });
    expect(staleAlerts([{ ...stale, stale_alerted_at: "2026-10-16T01:00:00Z" }], now)).toEqual([]);
    expect(staleAlerts([{ ...stale, stale_alerted_at: "2026-10-15T01:00:00Z" }], now).length).toBe(1);
  });
  it("reports a source that was scanned but never succeeded", () => {
    expect(staleAlerts([row({ last_ok_at: null, last_scan_at: "2026-10-01T00:00:00Z" })], now)[0].message).toMatch(/never completed a scan successfully/);
    expect(staleAlerts([row({ last_ok_at: null, last_scan_at: null })], now)).toEqual([]);
  });
});
