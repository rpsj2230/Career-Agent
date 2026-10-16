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

import { deriveProfileAnswers, estimateYears } from "@/lib/apply/answers";
import { mergeStandard, rowsToSave, STANDARD_QUESTIONS, toggleCsv } from "@/lib/standard-questions";
import { MasterProfile } from "@/lib/types";

const profile = MasterProfile.parse({
  basics: { name: "A", location: "Bengaluru, India", links: ["https://linkedin.com/in/a", "https://github.com/a", "https://a.dev"] },
  preferences: { countries: [], roles: [] },
  experience: [
    { id: "e1", company: "Acme", title: "Senior PM", start: "Jan 2021", end: "Present", bullets: [] },
    { id: "e2", company: "Old", title: "PM", start: "2016", end: "2020", bullets: [] },
  ],
  education: [{ id: "d1", school: "IIM", degree: "MBA", end: "2016" }],
});

describe("profile-derived answers", () => {
  it("estimates total experience from dates, treating Present as now", () => {
    expect(estimateYears(profile.experience, 2026)).toBe(10);
    expect(estimateYears([{ id: "x", company: "c", title: "t", bullets: [] }], 2026)).toBeNull();
  });
  it("fills what the profile already knows, without overriding the answer bank", () => {
    const a = buildAnswers([{ question: "Current location", answer: "Pune" }], { countries: [], roles: [] }, profile);
    expect(a.find((x) => x.question === "Current location")).toMatchObject({ answer: "Pune", source: "answer_bank" });
    expect(a.find((x) => x.question === "Total years of experience")?.answer).toBe(String(new Date().getFullYear() - 2016));
    expect(a.find((x) => x.question === "Current company")?.answer).toBe("Acme");
    expect(a.find((x) => x.question === "LinkedIn profile URL")?.answer).toBe("https://linkedin.com/in/a");
    expect(a.find((x) => x.question === "Highest qualification")?.answer).toBe("MBA");
    expect(deriveProfileAnswers(profile, 2026).length).toBeGreaterThanOrEqual(8);
  });
});

describe("standard questions", () => {
  it("recognises a saved answer as the standard question (ignoring case and punctuation) without duplicating it", () => {
    const rows = mergeStandard([{ question: "what is your NOTICE period", answer: "30 days" }, { question: "My custom question", answer: "x" }]);
    expect(rows[0]).toMatchObject({ answer: "30 days", standard: true });
    expect(rows[1]).toMatchObject({ answer: "x", standard: false });
    expect(rows.filter((r) => /notice period/i.test(r.question) && !/negotiable/i.test(r.question)).length).toBe(1);
    expect(rows.length).toBe(2 + STANDARD_QUESTIONS.length - 1); // the other standard questions are offered blank
    expect(rows.slice(2).every((r) => r.standard && r.answer === "" && r.group)).toBe(true);
  });
  it("persists only answered standard rows and all custom rows", () => {
    const rows = mergeStandard([{ question: "My custom question", answer: "" }]);
    rows.find((r) => r.question === "What is your current CTC?")!.answer = "24 LPA";
    const saved = rowsToSave(rows);
    expect(saved).toContainEqual({ question: "What is your current CTC?", answer: "24 LPA" });
    expect(saved).toContainEqual({ question: "My custom question", answer: "" });
    expect(saved.length).toBe(2);
  });
  it("toggles chips in a comma list", () => {
    expect(toggleCsv("in, sg", "ae")).toBe("in, sg, ae");
    expect(toggleCsv("in, sg", "SG")).toBe("in");
    expect(toggleCsv("", "in")).toBe("in");
  });
});
