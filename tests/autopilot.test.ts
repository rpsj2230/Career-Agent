import { describe, expect, it } from "vitest";
import { approvalsLeft, AUTOPILOT } from "@/lib/autopilot";
import { ScheduleInput } from "@/lib/schedule";

describe("Autopilot settings", () => {
  it("fit what the settings and schedule forms accept, so saving them can never be refused", () => {
    const parsed = ScheduleInput.safeParse({ name: "A", timezone: "Asia/Singapore", ...AUTOPILOT.schedule, days: [], countries: [], integrations: [] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ mode: "scan_prepare_apply", require_approval: false, max_apply: 100, frequency: "every_n_hours", interval_hours: 6 });
    expect(AUTOPILOT.caps.daily_total).toBeLessThanOrEqual(100);
    expect(AUTOPILOT.caps.daily_linkedin).toBeLessThanOrEqual(50);
    expect(AUTOPILOT.caps.weekly_linkedin).toBeLessThanOrEqual(200);
    expect(AUTOPILOT.autoPrepare.per_run).toBeLessThanOrEqual(100);
    expect(AUTOPILOT.autoPrepare.concurrency).toBeLessThanOrEqual(8);
  });
  it("keeps LinkedIn well under the overall daily limit", () => {
    expect(AUTOPILOT.caps.daily_linkedin).toBeLessThan(AUTOPILOT.caps.daily_total);
  });
  it("counts what may still be approved today", () => {
    expect(approvalsLeft(100, 40, 100)).toBe(60);
    expect(approvalsLeft(100, 100, 100)).toBe(0);
    expect(approvalsLeft(100, 0, 25)).toBe(25);
    expect(approvalsLeft(15, 20, 100)).toBe(0);
  });
});
