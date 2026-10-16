import { describe, expect, it } from "vitest";
import { decideApply } from "@/lib/apply/caps";
import { buildAnswers } from "@/lib/apply/answers";

const caps = { daily_total: 3, daily_linkedin: 2, weekly_linkedin: 5, linkedin_automation_enabled: false };
const zero = { automatedToday: 0, linkedinAutomatedToday: 0, linkedinAutomatedThisWeek: 0 };

describe("decideApply", () => {
  it("automates greenhouse/lever within the daily total, then blocks", () => {
    expect(decideApply("greenhouse", caps, zero)).toEqual({ allowed: true, mode: "automated" });
    expect(decideApply("lever", caps, { ...zero, automatedToday: 3 }).allowed).toBe(false);
  });
  it("keeps LinkedIn assisted unless automation is enabled", () => {
    expect(decideApply("linkedin", caps, zero)).toEqual({ allowed: true, mode: "assisted" });
  });
  it("enforces LinkedIn daily and weekly caps by downgrading to assisted", () => {
    const on = { ...caps, linkedin_automation_enabled: true };
    expect(decideApply("linkedin", on, zero).mode).toBe("automated");
    expect(decideApply("linkedin", on, { ...zero, linkedinAutomatedToday: 2 })).toMatchObject({ allowed: true, mode: "assisted" });
    expect(decideApply("linkedin", on, { ...zero, linkedinAutomatedThisWeek: 5 }).reason).toMatch(/weekly/);
    expect(decideApply("linkedin", on, { ...zero, automatedToday: 3 }).allowed).toBe(false);
  });
  it("always assists login-gated portals and unknown sites", () => {
    expect(decideApply("portal", caps, zero).mode).toBe("assisted");
    expect(decideApply("unknown", caps, zero).mode).toBe("assisted");
  });
});

describe("buildAnswers", () => {
  it("prefers the bank and fills gaps from preferences", () => {
    const a = buildAnswers(
      [{ question: "What is your notice period?", answer: "30 days" }, { question: "Empty", answer: " " }],
      { countries: [], roles: [], noticePeriod: "60 days", expectedCtc: "30 LPA", relocate: true },
    );
    expect(a.find((x) => /notice/i.test(x.question))?.answer).toBe("30 days");
    expect(a.find((x) => x.question === "Expected CTC")).toMatchObject({ answer: "30 LPA", source: "profile" });
    expect(a.some((x) => x.question === "Empty")).toBe(false);
    expect(a.find((x) => /relocate/i.test(x.question))?.answer).toBe("Yes");
  });
});
