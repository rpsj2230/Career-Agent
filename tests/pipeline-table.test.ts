import { describe, expect, it } from "vitest";
import { approvalRule, pipelineTable, type TableInput } from "@/lib/pipeline-table";

const base: TableInput = {
  last24h: { found: 172, scored: 64, matched: 32, prepared: 48, approved: 20, sent: 6 },
  waiting: { toScore: 0, toPrepare: 0, toApprove: 297, toSend: 12, needsYou: 5 },
  autoPrepare: { enabled: true, per_run: 100, concurrency: 4 },
  schedules: [{ name: "Daily search and prepare", mode: "scan_prepare_apply", max_prepare: 40, max_apply: 100, require_approval: false, enabled: true, paused: false }],
  caps: { daily_total: 300, daily_linkedin: 30, weekly_linkedin: 150, local_auto_enabled: true, company_cooldown_days: 5 },
  autoApplyOn: true, sentAutomaticallyToday: 7,
  discovery: { max_age_days: 14, min_rescan_hours: 6 }, scoring: { threshold: 65 },
};

describe("pipelineTable", () => {
  it("has the six steps in order, each with its own number for the last 24 hours", () => {
    const rows = pipelineTable(base);
    expect(rows.map((r) => r.step)).toEqual(["1. Find", "2. Score", "3. Match", "4. Prepare", "5. Approve", "6. Send"]);
    expect(rows.map((r) => r.last24h)).toEqual([172, 64, 32, 48, 20, 6]);
  });
  it("shows what is waiting only for the steps that have a queue", () => {
    const rows = pipelineTable(base);
    expect(rows.map((r) => r.waiting)).toEqual([undefined, 0, undefined, 0, 297, 12]);
  });
  it("keeps an unreadable number as null, so it is shown as ? and never as a believable 0", () => {
    const rows = pipelineTable({ ...base, last24h: { ...base.last24h, scored: null }, waiting: { ...base.waiting, toApprove: null } });
    expect(rows[1].last24h).toBeNull();
    expect(rows[4].waiting).toBeNull();
  });
  it("states each limit in words, with the figures from Settings", () => {
    const rows = pipelineTable(base);
    expect(rows[0].limit).toContain("14 days");
    expect(rows[0].limit).toContain("6 hours");
    expect(rows[2].question).toContain("65");
    expect(rows[3].limit).toContain("up to 40 resumes per run");
    expect(rows[3].limit).toContain("up to 100 resumes each, 4 at a time");
    expect(rows[4].limit).toContain("Up to 100 approvals per run");
    expect(rows[4].limit).toContain("5 days");
    expect(rows[5].limit).toContain("At most 300 automatic submissions a day (7 so far today)");
    expect(rows[5].limit).toContain("30 a day and 150 a week");
    expect(rows[5].limit).toContain("presses Submit itself");
  });
  it("says when nothing writes resumes", () => {
    const rows = pipelineTable({ ...base, schedules: [], autoPrepare: { enabled: false, per_run: 0, concurrency: 3 } });
    expect(rows[3].limit).toContain("No schedule writes resumes");
    expect(rows[3].limit).toContain("Catch-up rounds are switched off");
  });
  it("sends every step to where it is changed", () => {
    for (const r of pipelineTable(base)) expect(r.link.href).toMatch(/^\//);
  });
});

describe("approvalRule", () => {
  it("needs both the global switch and a schedule that applies without asking", () => {
    expect(approvalRule({ ...base, autoApplyOn: false })).toMatch(/Auto-Apply is off/);
    expect(approvalRule({ ...base, schedules: [] })).toMatch(/no schedule is set to apply/);
    expect(approvalRule({ ...base, schedules: [{ ...base.schedules[0], require_approval: true }] })).toMatch(/ask before submitting/);
    expect(approvalRule(base)).toMatch(/approved by itself/);
  });
  it("ignores a schedule that is paused or switched off", () => {
    expect(approvalRule({ ...base, schedules: [{ ...base.schedules[0], paused: true }] })).toMatch(/no schedule is set to apply/);
  });
});
