import { describe, expect, it } from "vitest";
import { decideAutoApply, type AutoApplyInput } from "@/lib/apply/policy";

const base: AutoApplyInput = {
  mode: "scan_prepare_apply", requireApproval: false, verified: true, applyType: "greenhouse",
  caps: { daily_total: 15, daily_linkedin: 10, weekly_linkedin: 40, linkedin_automation_enabled: false },
  capState: { automatedToday: 0, linkedinAutomatedToday: 0, linkedinAutomatedThisWeek: 0 },
  automatedThisRun: 0, maxApply: 3,
};

describe("decideAutoApply", () => {
  it("approves a verified, automatable application when the schedule is allowed to submit", () => {
    expect(decideAutoApply(base)).toMatchObject({ action: "approve", code: "ok" });
  });
  it("never approves when the schedule only scans or prepares", () => {
    expect(decideAutoApply({ ...base, mode: "scan" })).toMatchObject({ action: "leave", code: "scan_only" });
    expect(decideAutoApply({ ...base, mode: "scan_prepare" })).toMatchObject({ action: "leave", code: "scan_only" });
  });
  it("never approves when the schedule asks first", () => {
    expect(decideAutoApply({ ...base, requireApproval: true })).toMatchObject({ action: "leave", code: "approval_required" });
  });
  it("never approves documents with unverified claims", () => {
    expect(decideAutoApply({ ...base, verified: false })).toMatchObject({ action: "leave", code: "unverified" });
  });
  it("stops at the run limit for automatic submissions", () => {
    expect(decideAutoApply({ ...base, automatedThisRun: 3 })).toMatchObject({ action: "leave", code: "run_limit" });
    expect(decideAutoApply({ ...base, automatedThisRun: 2 })).toMatchObject({ action: "approve" });
  });
  it("respects the daily cap and says why", () => {
    const r = decideAutoApply({ ...base, capState: { ...base.capState, automatedToday: 15 } });
    expect(r).toMatchObject({ action: "leave", code: "cap" });
    expect(r.reason).toMatch(/Daily limit of 15/);
  });
  it("hands portals that cannot be automated to the user as manual work, not as a skip, and ignores the run limit for them", () => {
    const r = decideAutoApply({ ...base, applyType: "portal", automatedThisRun: 99 });
    expect(r.action).toBe("approve");
    expect(r.reason).toMatch(/final submit/);
  });
  it("keeps LinkedIn manual unless its automation is switched on", () => {
    expect(decideAutoApply({ ...base, applyType: "linkedin" }).reason).toMatch(/final submit/);
  });
});
