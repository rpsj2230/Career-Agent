import { describe, expect, it } from "vitest";
import { ungroundedFigure, usableWritten, richFacts, writtenPrompt, WRITTEN_SYSTEM } from "../src/lib/autofill/written-answers";
import { STANDARD_QUESTIONS, WRITTEN_QUESTIONS, WRITTEN_GROUP, mergeStandard } from "../src/lib/standard-questions";
import { MasterProfile } from "../src/lib/types";

const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", location: "Singapore", headline: "AI transformation leader" },
  experience: [{ id: "e1", company: "Verz", title: "Operations Director", start: "2017", end: "Present", bullets: [{ id: "b1", text: "Led a 150-person delivery organisation across 4 countries" }, { id: "b2", text: "Cut resolution time by 35% with an AI triage agent" }] }],
  skills: [{ id: "s1", name: "Programme management" }],
});
const facts = richFacts(profile);

describe("the interview questions", () => {
  it("are all in the answer bank list, in the owner's wording, as their own group", () => {
    expect(WRITTEN_QUESTIONS).toHaveLength(19);
    const rows = mergeStandard([]);
    for (const q of WRITTEN_QUESTIONS) expect(rows.find((r) => r.question === q)?.group, q).toBe(WRITTEN_GROUP);
    expect(STANDARD_QUESTIONS.filter((s) => s.group === WRITTEN_GROUP)).toHaveLength(19);
  });
});

describe("drafting answers from the profile", () => {
  it("puts the whole profile in the prompt and forbids inventing anything", () => {
    const p = writtenPrompt(profile, ["Why should we hire you?"]);
    expect(p).toContain("Operations Director at Verz");
    expect(p).toContain("150-person delivery organisation");
    expect(p).toContain("0. Why should we hire you?");
    expect(WRITTEN_SYSTEM).toMatch(/Never invent/);
    expect(WRITTEN_SYSTEM).toMatch(/never name the employer/);
  });
  it("accepts figures that are in the profile and refuses ones that are not", () => {
    expect(ungroundedFigure("I led a 150-person organisation across 4 countries and cut resolution time by 35%.", facts)).toBeNull();
    expect(ungroundedFigure("I grew revenue by 60% in two years.", facts)).toBe("60%");
    expect(ungroundedFigure("I led 200 people.", facts)).toBe("200");
  });
  it("keeps good answers, and lists the rest with the reason", () => {
    const qs = ["Why should we hire you?", "Describe a time you resolved a conflict.", "What are your career goals?", "What are your key strengths?", "Describe your leadership style."];
    const good = "I have led delivery organisations of 150 people across 4 countries and cut resolution time by 35% with an AI triage agent, so I bring both scale and practical automation.";
    const { kept, dropped } = usableWritten(qs, { answers: [
      { index: 0, answer: good },
      { index: 1, answer: null },
      { index: 2, answer: "I want to grow into [ROLE] at [COMPANY] and keep leading AI transformation work for large organisations." },
      { index: 3, answer: "I grew revenue by 60% by building a high-performing team that delivers reliably across regions and time zones." },
    ] }, facts);
    expect(kept.map((k) => k.question)).toEqual(["Why should we hire you?"]);
    expect(Object.fromEntries(dropped.map((d) => [d.question, d.why]))).toEqual({
      "Describe a time you resolved a conflict.": "your profile does not give enough to answer this honestly",
      "What are your career goals?": "the draft contained a placeholder",
      "What are your key strengths?": 'the draft stated "60%", which is not in your profile',
      "Describe your leadership style.": "the model gave no answer",
    });
  });
});
