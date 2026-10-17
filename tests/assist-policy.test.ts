import { describe, expect, it } from "vitest";
import { autoDecision, humanPause, withinHours } from "../worker/assist-policy";

const caps = { daily_total: 15, daily_linkedin: 10, weekly_linkedin: 40, linkedin_automation_enabled: false, local_auto_enabled: true };
const none = { submittedToday: 0, linkedinToday: 0, linkedinThisWeek: 0 };

describe("hands-free mode rules", () => {
  it("is off unless you switch it on", () => {
    expect(autoDecision("naukri", { ...caps, local_auto_enabled: false }, none)).toEqual({ go: false, reason: expect.stringMatching(/switched off/) });
    expect(autoDecision("naukri", { ...caps, local_auto_enabled: undefined }, none).go).toBe(false);
  });
  it("applies on login-gated portals within the daily total", () => {
    expect(autoDecision("naukri", caps, none)).toEqual({ go: true });
    expect(autoDecision("naukri", caps, { ...none, submittedToday: 14 })).toEqual({ go: true });
    expect(autoDecision("naukri", caps, { ...none, submittedToday: 15 })).toEqual({ go: false, reason: expect.stringMatching(/Daily limit of 15/) });
  });
  it("needs LinkedIn's own opt-in and respects its daily and weekly caps", () => {
    expect(autoDecision("linkedin", caps, none)).toEqual({ go: false, reason: expect.stringMatching(/LinkedIn is switched off|LinkedIn applying is switched off/) });
    const on = { ...caps, linkedin_automation_enabled: true };
    expect(autoDecision("linkedin", on, none)).toEqual({ go: true });
    expect(autoDecision("linkedin", on, { ...none, linkedinToday: 10 })).toEqual({ go: false, reason: expect.stringMatching(/daily limit \(10\)/) });
    expect(autoDecision("linkedin", on, { ...none, linkedinThisWeek: 40 })).toEqual({ go: false, reason: expect.stringMatching(/weekly limit \(40\)/) });
  });
  it("a LinkedIn cap does not stop other portals", () => {
    expect(autoDecision("indeed", { ...caps, linkedin_automation_enabled: true }, { ...none, linkedinToday: 10 })).toEqual({ go: true });
  });
});

describe("active hours", () => {
  const at = (h: number) => new Date(2026, 9, 17, h, 30);
  it("limits work to the hours you choose", () => {
    expect(withinHours(at(10), "9-21")).toBe(true);
    expect(withinHours(at(21), "9-21")).toBe(false);
    expect(withinHours(at(8), "9-21")).toBe(false);
  });
  it("handles windows that wrap past midnight, and no setting", () => {
    expect(withinHours(at(23), "22-6")).toBe(true);
    expect(withinHours(at(3), "22-6")).toBe(true);
    expect(withinHours(at(12), "22-6")).toBe(false);
    expect(withinHours(at(3), undefined)).toBe(true);
    expect(withinHours(at(3), "nonsense")).toBe(true);
  });
});

describe("pacing", () => {
  it("stays within the range", () => {
    expect(humanPause(45, 120, () => 0)).toBe(45_000);
    expect(humanPause(45, 120, () => 1)).toBe(120_000);
    for (let i = 0; i < 50; i++) { const p = humanPause(); expect(p).toBeGreaterThanOrEqual(45_000); expect(p).toBeLessThanOrEqual(120_000); }
  });
});
