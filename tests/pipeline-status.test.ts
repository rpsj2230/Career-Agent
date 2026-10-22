import { describe, expect, it } from "vitest";
import { explainPipeline, type PipelineInput } from "@/lib/pipeline-status";

const base = (o: Partial<PipelineInput> = {}): PipelineInput => ({
  now: new Date("2026-10-19T12:00:00Z"),
  jobs: { new: 0, queued: 0, saved: 0, prepared: 0, applied: 0, skipped: 0 },
  apps: { prepared: 0, approved: 0, submitting: 0, assisted_pending: 0, needs_input: 0, failed: 0, submitted: 0 },
  oldestSending: null,
  models: { usable: 3, message: null, allFailing: false, allAtLimit: false, lastError: null },
  paused: false, autoApply: true,
  autoPrepare: { enabled: true, per_run: 15, concurrency: 3 },
  caps: { daily_total: 15, local_auto_enabled: true },
  automatedToday: 0,
  schedules: { active: 1, preparing: true, requireApproval: false, nextRunAt: "2026-10-19T13:00:00Z" },
  dispatchConfigured: true, tickAt: "2026-10-19T11:30:00Z", lastPipeline: { status: "succeeded", started_at: "2026-10-19T11:00:00Z", error: null },
  drain: null, assistant: null,
  ...o,
});
const stage = (i: PipelineInput, id: string) => explainPipeline(i).stages.find((s) => s.id === id)!;
const causes = (i: PipelineInput, id: string) => stage(i, id).reasons.map((r) => r.cause);

describe("explainPipeline: how much is done", () => {
  it("gives counts and percentages for each step", () => {
    const i = base({ jobs: { new: 1358, queued: 40, saved: 5, prepared: 60, applied: 100, skipped: 1035 }, apps: { prepared: 30, approved: 0, submitting: 0, assisted_pending: 20, needs_input: 4, failed: 2, submitted: 100 } });
    const sc = stage(i, "score"); expect(sc.waiting).toBe(1358); expect(sc.pct).toBe(48); // (40+5+60+100+1035)=1240 of 2598
    const rs = stage(i, "resume"); expect(rs.waiting).toBe(40); expect(rs.pct).toBe(80); // 160 of 200
    expect(stage(i, "approve").pct).toBe(81); // 126 decided of 156
  });
  it("is clear when nothing waits", () => {
    const r = explainPipeline(base({ jobs: { new: 0, queued: 0, saved: 0, prepared: 5, applied: 5, skipped: 5 } }));
    expect(r.stages.every((s) => s.state === "clear")).toBe(true);
    expect(r.headline).toMatch(/up to date/);
  });
});

describe("explainPipeline: why it waits", () => {
  const waitingToScore = (o: Partial<PipelineInput>) => base({ jobs: { new: 500, queued: 0, saved: 0, prepared: 0, applied: 0, skipped: 0 }, ...o });
  it("calls out a missing AI model", () => {
    const i = waitingToScore({ models: { usable: 0, message: "No model has an API key.", allFailing: false, allAtLimit: false, lastError: null } });
    expect(causes(i, "score")).toContain("model"); expect(stage(i, "score").state).toBe("blocked");
  });
  it("separates a failing model from a used-up allowance", () => {
    expect(causes(waitingToScore({ models: { usable: 2, message: null, allFailing: true, allAtLimit: false, lastError: "429 rate limit" } }), "score")).toEqual(["model"]);
    expect(causes(waitingToScore({ models: { usable: 2, message: null, allFailing: false, allAtLimit: true, lastError: null } }), "score")).toEqual(["limit"]);
  });
  it("names server problems: GitHub not connected, hourly check silent, last run failed", () => {
    expect(causes(waitingToScore({ dispatchConfigured: false }), "score")).toContain("server");
    expect(causes(waitingToScore({ tickAt: "2026-10-18T00:00:00Z" }), "score")).toContain("server");
    const failed = waitingToScore({ lastPipeline: { status: "failed", started_at: "2026-10-19T11:00:00Z", error: "boom" } });
    expect(stage(failed, "score").reasons.some((r) => r.cause === "server" && /boom/.test(r.text))).toBe(true);
  });
  it("names settings: paused, no schedule", () => {
    expect(causes(waitingToScore({ paused: true }), "score")).toContain("setting");
    expect(causes(waitingToScore({ schedules: { active: 0, preparing: false, requireApproval: false, nextRunAt: null } }), "score")).toContain("setting");
  });
  it("says it is normal when nothing is wrong", () => {
    const i = waitingToScore({});
    expect(causes(i, "score")).toEqual(["normal"]); expect(stage(i, "score").state).toBe("flowing");
  });
  it("explains resumes: auto-prepare off, scan-only schedule, per-round pace", () => {
    const q = { jobs: { new: 0, queued: 100, saved: 0, prepared: 0, applied: 0, skipped: 0 } };
    expect(causes(base({ ...q, autoPrepare: { enabled: false, per_run: 15, concurrency: 3 } }), "resume")).toContain("setting");
    expect(causes(base({ ...q, schedules: { active: 1, preparing: false, requireApproval: false, nextRunAt: null } }), "resume")).toContain("setting");
    const pace = stage(base(q), "resume").reasons[0]; expect(pace.cause).toBe("normal"); expect(pace.text).toMatch(/up to 15 per round, 3 at a time, so about 7 rounds/);
  });
  it("explains approvals: Auto-Apply off is on you, a reached daily limit is a limit", () => {
    const a = { apps: { prepared: 30, approved: 0, submitting: 0, assisted_pending: 0, needs_input: 0, failed: 0, submitted: 0 } };
    const off = base({ ...a, autoApply: false }); expect(causes(off, "approve")).toEqual(["you"]); expect(stage(off, "approve").state).toBe("you");
    const cap = base({ ...a, automatedToday: 15 }); expect(causes(cap, "approve")).toContain("limit"); expect(stage(cap, "approve").state).toBe("blocked");
  });
  it("explains sending: stuck worker, offline assistant, Hands-free off", () => {
    const stuck = base({ apps: { prepared: 0, approved: 3, submitting: 0, assisted_pending: 0, needs_input: 0, failed: 0, submitted: 0 }, oldestSending: "2026-10-19T10:00:00Z" });
    expect(causes(stuck, "send")).toEqual(["server"]);
    // approved applications that are for the assistant (LinkedIn, employer sites) are waiting for the assistant, not for a stopped cloud worker
    const mixed = base({ apps: { prepared: 0, approved: 3, submitting: 0, assisted_pending: 0, needs_input: 0, failed: 0, submitted: 0 }, approvedForAssistant: 3, oldestSending: null });
    const send = explainPipeline(mixed).stages.find((s) => s.id === "send")!;
    expect(send.state).not.toBe("blocked");
    expect(send.reasons.some((r) => r.cause === "server" && /may have stopped/.test(r.text))).toBe(false);
    expect(send.waiting).toBe(3);
    const cloudStuck = explainPipeline(base({ apps: { prepared: 0, approved: 3, submitting: 0, assisted_pending: 0, needs_input: 0, failed: 0, submitted: 0 }, approvedForAssistant: 2, oldestSending: "2026-10-19T10:00:00Z" })).stages.find((s) => s.id === "send")!;
    expect(cloudStuck.state).toBe("blocked");
    expect(cloudStuck.reasons[0].text).toMatch(/^1 application approved or sending/);
    const off = base({ apps: { prepared: 0, approved: 0, submitting: 0, assisted_pending: 8, needs_input: 0, failed: 0, submitted: 0 }, assistant: { relevant: true, offline: true, text: "The assistant has not reported for 5 hours." } });
    expect(causes(off, "send")).toEqual(["server"]);
    const hands = base({ apps: { prepared: 0, approved: 0, submitting: 0, assisted_pending: 8, needs_input: 0, failed: 0, submitted: 0 }, caps: { daily_total: 15, local_auto_enabled: false } });
    expect(causes(hands, "send")).toEqual(["setting"]);
  });
  it("lists hand-backs and failures under Needs you", () => {
    const i = base({ apps: { prepared: 0, approved: 0, submitting: 0, assisted_pending: 0, needs_input: 4, failed: 2, submitted: 0 } });
    expect(stage(i, "attention").waiting).toBe(6); expect(causes(i, "attention")).toEqual(["you", "server"]);
  });
  it("counts blocked steps in the headline", () => {
    const r = explainPipeline(base({ jobs: { new: 10, queued: 10, saved: 0, prepared: 0, applied: 0, skipped: 0 }, models: { usable: 0, message: null, allFailing: false, allAtLimit: false, lastError: null } }));
    expect(r.blocked).toBe(2); expect(r.headline).toMatch(/2 steps are blocked/);
  });
});
