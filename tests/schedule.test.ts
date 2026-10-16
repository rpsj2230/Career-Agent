import { describe, expect, it } from "vitest";
import { computeNextRun, describeSchedule, isDue, ScheduleInput } from "@/lib/schedule";

const t = (o: Partial<Parameters<typeof computeNextRun>[0]> = {}) => ({ frequency: "daily" as const, days: [], interval_hours: null, time_of_day: "09:00", timezone: "Asia/Kolkata", ...o });
const iso = (d: Date) => d.toISOString();

describe("computeNextRun", () => {
  it("daily: later today if the time has not passed, otherwise tomorrow (in the schedule's zone)", () => {
    expect(iso(computeNextRun(t(), new Date("2026-10-16T02:00:00Z")))).toBe("2026-10-16T03:30:00.000Z"); // 07:30 IST -> 09:00 IST today
    expect(iso(computeNextRun(t(), new Date("2026-10-16T03:30:00Z")))).toBe("2026-10-17T03:30:00.000Z"); // exactly now -> strictly after
  });
  it("weekdays skips the weekend", () => {
    // Fri 2026-10-16 10:00 IST -> next is Mon 2026-10-19 09:00 IST
    expect(iso(computeNextRun(t({ frequency: "weekdays" }), new Date("2026-10-16T05:00:00Z")))).toBe("2026-10-19T03:30:00.000Z");
  });
  it("weekly uses the chosen days (0 = Sunday)", () => {
    expect(iso(computeNextRun(t({ frequency: "weekly", days: [0] }), new Date("2026-10-16T05:00:00Z")))).toBe("2026-10-18T03:30:00.000Z");
    expect(iso(computeNextRun(t({ frequency: "weekly", days: [5] }), new Date("2026-10-16T05:00:00Z")))).toBe("2026-10-23T03:30:00.000Z"); // Friday already passed today
  });
  it("every N hours adds the interval", () => {
    expect(iso(computeNextRun(t({ frequency: "every_n_hours", interval_hours: 6 }), new Date("2026-10-16T05:00:00Z")))).toBe("2026-10-16T11:00:00.000Z");
  });
  it("keeps the local wall-clock time across a DST change (London, clocks go back 25 Oct 2026)", () => {
    const s = t({ timezone: "Europe/London" });
    expect(iso(computeNextRun(s, new Date("2026-10-24T09:00:00Z")))).toBe("2026-10-25T09:00:00.000Z"); // 09:00 GMT
    expect(iso(computeNextRun(s, new Date("2026-10-23T09:00:00Z")))).toBe("2026-10-24T08:00:00.000Z"); // 09:00 BST
  });
  it("a time that does not exist on a spring-forward day runs just after the gap (New York, 8 Mar 2026)", () => {
    const next = computeNextRun(t({ timezone: "America/New_York", time_of_day: "02:30" }), new Date("2026-03-08T05:00:00Z"));
    expect(next.getTime()).toBeGreaterThan(new Date("2026-03-08T05:00:00Z").getTime());
    expect(next.getTime() - new Date("2026-03-08T05:00:00Z").getTime()).toBeLessThan(26 * 3600_000);
  });
  it("different zones give different instants for the same wall time", () => {
    const a = computeNextRun(t({ timezone: "Asia/Singapore" }), new Date("2026-10-16T00:00:00Z"));
    const b = computeNextRun(t({ timezone: "Asia/Kolkata" }), new Date("2026-10-16T00:00:00Z"));
    expect(b.getTime() - a.getTime()).toBe(2.5 * 3600_000);
  });
});

describe("isDue", () => {
  const now = new Date("2026-10-16T10:00:00Z");
  it("is due when the time has come", () => expect(isDue({ enabled: true, paused: false, next_run_at: "2026-10-16T09:59:00Z" }, now)).toBe(true));
  it("is not due before its time", () => expect(isDue({ enabled: true, paused: false, next_run_at: "2026-10-16T10:01:00Z" }, now)).toBe(false));
  it("never runs while paused or disabled", () => {
    expect(isDue({ enabled: true, paused: true, next_run_at: "2026-10-16T09:00:00Z" }, now)).toBe(false);
    expect(isDue({ enabled: false, paused: false, next_run_at: "2026-10-16T09:00:00Z" }, now)).toBe(false);
  });
});

describe("ScheduleInput", () => {
  const ok = { name: "Morning", frequency: "daily", time_of_day: "08:30", timezone: "Asia/Singapore" };
  it("accepts a valid schedule and applies defaults", () => {
    expect(ScheduleInput.parse(ok)).toMatchObject({ enabled: true, mode: "scan_prepare", require_approval: true, max_apply: 0 });
  });
  it("rejects unknown time zones, bad times and missing names", () => {
    expect(ScheduleInput.safeParse({ ...ok, timezone: "Mars/Base" }).success).toBe(false);
    expect(ScheduleInput.safeParse({ ...ok, time_of_day: "25:00" }).success).toBe(false);
    expect(ScheduleInput.safeParse({ ...ok, name: "  " }).success).toBe(false);
  });
  it("weekly needs days and every_n_hours needs an interval", () => {
    expect(ScheduleInput.safeParse({ ...ok, frequency: "weekly" }).success).toBe(false);
    expect(ScheduleInput.safeParse({ ...ok, frequency: "every_n_hours" }).success).toBe(false);
    expect(ScheduleInput.parse({ ...ok, frequency: "weekly", days: [3, 1, 3] }).days).toEqual([1, 3]);
  });
  it("only an applying schedule keeps apply limits, and approval is always required otherwise", () => {
    expect(ScheduleInput.parse({ ...ok, mode: "scan", max_prepare: 50, max_apply: 5, require_approval: false })).toMatchObject({ max_prepare: 0, max_apply: 0, require_approval: true });
    expect(ScheduleInput.parse({ ...ok, mode: "scan_prepare_apply", max_apply: 5, require_approval: false })).toMatchObject({ max_apply: 5, require_approval: false });
  });
});

describe("describeSchedule", () => {
  it("reads naturally", () => {
    expect(describeSchedule(t({ frequency: "weekly", days: [1, 4] }))).toBe("Mon, Thu at 09:00 (Asia/Kolkata)");
    expect(describeSchedule(t({ frequency: "every_n_hours", interval_hours: 1 }))).toBe("Every 1 hour");
  });
});
