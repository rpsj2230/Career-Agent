import { describe, expect, it } from "vitest";
import { limitsOverview, type LimitsInput } from "@/lib/limits-overview";

const base: LimitsInput = {
  autoPrepare: { enabled: true, per_run: 15, concurrency: 3 },
  schedules: [{ name: "Morning run", describe: "Every day at 09:00 (Asia/Singapore)", mode: "scan_prepare", max_prepare: 20, max_apply: 10, require_approval: true, enabled: true, paused: false }],
  caps: { daily_total: 15, daily_linkedin: 10, weekly_linkedin: 40, local_auto_enabled: true, company_cooldown_days: 14 },
  autoApplyOn: true, last24h: { found: 900, scored: 800, matched: 200, prepared: 120, sentAutomatically: 4 }, waitingForResume: 30, waitingForScore: 12,
  discovery: { max_age_days: 30, min_rescan_hours: 6 }, scoring: { threshold: 65, min_evidence: 20 },
};
const text = (i: LimitsInput) => limitsOverview(i).map((r) => `${r.what} ${r.limit} ${r.now ?? ""}`).join("\n");

describe("limitsOverview", () => {
  it("separates writing resumes from sending, and says catch-up rounds add to a schedule's number", () => {
    const rows = limitsOverview(base);
    expect(rows.filter((r) => r.group === "Resumes").length).toBe(3);
    expect(text(base)).toContain("no total limit");
    expect(text(base)).toContain("fit score of 65 or more");
    expect(rows.find((r) => r.group === "Find")?.now).toBe("900 found");
    expect(text(base)).toContain("writes up to 20 resumes each time it runs");
    expect(text(base)).toContain("write up to 15 resumes per round");
    expect(text(base)).toContain("no daily limit of their own");
    expect(rows.find((r) => r.what === "Resumes written in the last 24 hours")?.now).toBe("120");
  });
  it("shows the daily sending cap with today's count, and that a schedule asking first holds everything", () => {
    const rows = limitsOverview(base);
    expect(rows.find((r) => r.what.startsWith("Automatic submissions"))?.now).toBe("4 of 15");
    expect(text(base)).toContain("no schedule is set to");
    const askApply = { ...base, schedules: [{ ...base.schedules[0], mode: "scan_prepare_apply" as const, require_approval: true }] };
    expect(text(askApply)).toContain("Ask me before submitting");
  });
  it("lists per-run sending only for schedules that apply, and handles everything switched off", () => {
    expect(text(base)).not.toContain("approves and submits up to");
    const applying = { ...base, schedules: [{ ...base.schedules[0], mode: "scan_prepare_apply" as const, require_approval: false, max_apply: 7 }] };
    expect(text(applying)).toContain("approves and submits up to 7 applications each time it runs");
    expect(text(applying)).toContain("applies without asking");
    const off = { ...base, autoPrepare: { ...base.autoPrepare, enabled: false }, schedules: [], autoApplyOn: false };
    expect(text(off)).toContain("no schedule writes resumes");
    expect(text(off)).toContain("switched off: only schedules");
    expect(text(off)).toContain("Auto-Apply is off");
  });
});

import { roundText } from "@/lib/apply/assistant-request";
describe("roundText", () => {
  it("says why applications were left", () => {
    expect(roundText(null)).toBe("");
    expect(roundText({ at: "x" })).toBe("");
    expect(roundText({ at: "x", round: { at: "x", submitted: 0, handedBack: 2, left: { "Automatic LinkedIn applying is switched off in Settings": 31 } } })).toBe(" Last round: 0 sent, 2 handed back, 31 left for later (Automatic LinkedIn applying is switched off in Settings: 31).");
    expect(roundText({ at: "x", round: { at: "x", submitted: 3, handedBack: 0, left: {} } })).toBe(" Last round: 3 sent, 0 handed back.");
  });
});
