import { describe, expect, it } from "vitest";
import { ago, evaluateHealth, worst, type HealthInput } from "@/lib/automation-checks";

const now = new Date("2026-10-18T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const good: HealthInput = {
  now, tickAt: hoursAgo(1), schedules: [{ name: "Daily", enabled: true, paused: false, next_run_at: new Date(now.getTime() + 3_600_000).toISOString() }],
  lastPipeline: { status: "succeeded", started_at: hoursAgo(5), finished_at: hoursAgo(4.9), error: null },
  models: { usable: 2, message: null }, dispatchConfigured: true, profileReady: true, titles: 3, countries: 2, newJobs: 0, queuedJobs: 4, autoApply: false,
};
const by = (i: HealthInput, id: string) => evaluateHealth(i).find((c) => c.id === id)!;

describe("automation checklist", () => {
  it("everything fine: no warnings or failures", () => {
    expect(worst(evaluateHealth(good))).toBe("ok");
  });

  it("the hourly check: never reached, late, and silent for a day", () => {
    expect(by({ ...good, tickAt: null }, "tick")).toMatchObject({ status: "fail" });
    expect(by({ ...good, tickAt: null }, "tick").fix).toMatch(/APP_URL.*CRON_SECRET/);
    expect(by({ ...good, tickAt: hoursAgo(4) }, "tick").status).toBe("ok"); // GitHub often runs scheduled checks a few hours apart
    expect(by({ ...good, tickAt: hoursAgo(9) }, "tick").status).toBe("warn");
    expect(by({ ...good, tickAt: hoursAgo(30) }, "tick").status).toBe("fail");
  });

  it("schedule: none, all off, overdue", () => {
    expect(by({ ...good, schedules: [] }, "schedule").status).toBe("fail");
    expect(by({ ...good, schedules: [{ name: "D", enabled: false, paused: false, next_run_at: null }] }, "schedule").status).toBe("fail");
    expect(by({ ...good, schedules: [{ name: "D", enabled: true, paused: true, next_run_at: null }] }, "schedule").status).toBe("fail");
    expect(by({ ...good, schedules: [{ name: "D", enabled: true, paused: false, next_run_at: hoursAgo(10) }] }, "schedule").status).toBe("warn");
  });

  it("models: unusable keys fail with the specific reason", () => {
    const c = by({ ...good, models: { usable: 0, message: "No model can be used here: 2 key(s) cannot be read" } }, "models");
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/cannot be read/);
  });

  it("buttons: missing GitHub variables warn and say exactly what to set", () => {
    const c = by({ ...good, dispatchConfigured: false }, "dispatch");
    expect(c.status).toBe("warn");
    expect(c.fix).toMatch(/GITHUB_REPO.*GITHUB_DISPATCH_TOKEN/);
  });

  it("last run: failed, partial, stuck, none yet", () => {
    expect(by({ ...good, lastPipeline: { status: "failed", started_at: hoursAgo(2), finished_at: hoursAgo(2), error: "boom" } }, "run")).toMatchObject({ status: "fail" });
    expect(by({ ...good, lastPipeline: { status: "partial", started_at: hoursAgo(2), finished_at: hoursAgo(2), error: "scoring failed" } }, "run").status).toBe("warn");
    expect(by({ ...good, lastPipeline: { status: "running", started_at: hoursAgo(3), finished_at: null, error: null } }, "run").status).toBe("warn");
    expect(by({ ...good, lastPipeline: { status: "running", started_at: hoursAgo(0.2), finished_at: null, error: null } }, "run").status).toBe("ok");
    expect(by({ ...good, lastPipeline: null }, "run").status).toBe("warn");
  });

  it("what to search: lists exactly what is missing", () => {
    const c = by({ ...good, profileReady: false, titles: 0, countries: 0 }, "setup");
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/profile.*target roles.*country/);
  });

  it("a backlog of unscored jobs is reported with what to do", () => {
    const c = by({ ...good, newJobs: 366 }, "backlog");
    expect(c.detail).toMatch(/366 new job/);
    expect(by({ ...good, newJobs: 366, models: { usable: 0, message: "x" } }, "backlog").status).toBe("warn");
    expect(evaluateHealth(good).some((c) => c.id === "backlog")).toBe(false);
  });

  it("ages read naturally", () => {
    expect(ago(null, now)).toBe("never");
    expect(ago(hoursAgo(0.01), now)).toBe("just now");
    expect(ago(hoursAgo(0.5), now)).toBe("30 min ago");
    expect(ago(hoursAgo(5), now)).toBe("5 h ago");
    expect(ago(hoursAgo(72), now)).toBe("3 days ago");
  });
});
