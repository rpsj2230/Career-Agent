import { describe, expect, it } from "vitest";
import { AI_SYSTEM, buildAiPrompt, factsFor, usableAnswers } from "../worker/ai-answers-core";
import { CONSENT_BOX, type Pending } from "../worker/form";
import { MasterProfile } from "../src/lib/types";

const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", email: "a@x.com", location: "Singapore", links: [] },
  experience: [{ id: "exp1", company: "Verz", title: "Operations Director", start: "2017", end: "Present", bullets: [{ id: "exp1.b1", text: "Led a 150-person delivery organisation across 4 countries" }] }],
  skills: [{ id: "skill1", name: "Programme management" }],
  preferences: { countries: [], roles: [], noticePeriod: "30 days" },
});
const pending: Pending[] = [
  { label: "Why do you want this role?", type: "textarea", options: [], required: true },
  { label: "Are you legally authorised to work here?", type: "radio", options: ["Yes", "No"], required: true },
  { label: "Gender", type: "select", options: ["Male", "Female", "Prefer not to say"], required: true },
  { label: "Years with Kubernetes", type: "number", options: [], required: true },
];

describe("AI answers for form questions", () => {
  it("builds a prompt from the profile only and tells the model to answer null rather than guess", () => {
    const p = buildAiPrompt({ profile, bank: [{ question: "Notice period", answer: "30 days" }], job: { title: "PM", company: "Acme" }, pending });
    expect(p).toContain("Operations Director at Verz");
    expect(p).toContain("OPTIONS: \"Prefer not to say\"".slice(0, 8));
    expect(p).toContain("Notice period: 30 days");
    expect(AI_SYSTEM).toMatch(/null is better than a guess/);
    expect(factsFor(profile)).toContain("Programme management");
  });
  it("keeps only usable answers: a choice must be an option, nulls and filler words are dropped, numbers are numbers", () => {
    const out = usableAnswers(pending, { answers: [
      { index: 0, answer: "  I have led delivery teams across four countries.  " },
      { index: 1, answer: "yes" },
      { index: 2, answer: "Prefer not to say" },
      { index: 3, answer: "null" },
    ] });
    expect(out).toEqual([
      { question: "Why do you want this role?", answer: "I have led delivery teams across four countries." },
      { question: "Are you legally authorised to work here?", answer: "Yes" },
      { question: "Gender", answer: "Prefer not to say" },
    ]);
    expect(usableAnswers(pending, { answers: [{ index: 1, answer: "Maybe" }, { index: 9, answer: "x" }, { index: 3, answer: "about 5 years" }] })).toEqual([{ question: "Years with Kubernetes", answer: "5" }]);
  });
  it("ticks plain agreements and leaves anything else required to the person", () => {
    for (const l of ["I agree to the Terms and Conditions", "I have read the privacy policy", "I consent to the processing of my data", "I certify the information above is true and complete"]) expect(CONSENT_BOX.test(l), l).toBe(true);
    for (const l of ["Are you willing to travel 50%?", "I am a veteran", "Sign me up for the newsletter"]) expect(CONSENT_BOX.test(l), l).toBe(false);
  });
});
