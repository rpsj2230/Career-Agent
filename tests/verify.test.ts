import { describe, expect, it } from "vitest";
import { buildDiff, numbersIn, verifyCoverLetter, verifyTailored } from "@/lib/docs/verify";
import type { MasterProfile, TailoredResume } from "@/lib/types";

const profile: MasterProfile = {
  basics: { name: "A", email: "", phone: "", location: "", headline: "Product Manager", summary: "PM with 6 years in fintech", links: [], credentials: "", workStatus: "" },
  preferences: { countries: ["in"], roles: [] },
  experience: [
    {
      id: "exp1", company: "Acme", title: "PM", start: "2020", end: "Present",
      bullets: [
        { id: "b1", text: "Grew activation by 24% across 3 markets" },
        { id: "b2", text: "Led a team of 5 engineers" },
      ],
    },
  ],
  education: [],
  highlights: [{ id: "h1", text: "Grew activation by 24% across 3 markets" }], caseStudies: [], development: [], awards: [],
  skills: [{ id: "s1", name: "SQL" }, { id: "s2", name: "Roadmapping" }],
  certifications: [],
};

const good: TailoredResume = {
  headline: "Product Manager",
  summary: { text: "Fintech PM with 6 years of experience", sourceIds: ["summary"] },
  experience: [{ experienceId: "exp1", bullets: [{ text: "Raised activation 24% in 3 markets", sourceIds: ["b1"] }] }],
  skillIds: ["s1"],
  certificationIds: [], highlightIds: [],
};

describe("verifyTailored", () => {
  it("accepts a faithful rewrite", () => {
    const r = verifyTailored(profile, good);
    expect(r.ok).toBe(true);
    expect(r.mapping["exp1#0"]).toEqual(["b1"]);
  });
  it("rejects an invented number", () => {
    const bad = structuredClone(good);
    bad.experience[0].bullets[0].text = "Raised activation 40% in 3 markets";
    const r = verifyTailored(profile, bad);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.problem).join("|")).toMatch(/40/);
  });
  it("rejects unknown fact ids, unknown skills and uncited text", () => {
    const bad = structuredClone(good);
    bad.experience[0].bullets.push({ text: "Did a thing", sourceIds: [] }, { text: "Did X", sourceIds: ["nope"] });
    bad.skillIds.push("s99");
    const problems = verifyTailored(profile, bad).issues.map((i) => i.problem).join("|");
    expect(problems).toMatch(/no source fact cited/);
    expect(problems).toMatch(/unknown fact id/);
    expect(problems).toMatch(/skill id not in master/);
  });
  it("rejects an experience id that does not exist", () => {
    const bad = structuredClone(good);
    bad.experience[0].experienceId = "ghost";
    expect(verifyTailored(profile, bad).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("normalises numbers", () => expect(numbersIn("Saved ₹1,200,000 (12.5%)")).toEqual(["1200000", "12.5"]));
  it("checks cover letters", () =>
    expect(verifyCoverLetter(profile, { text: "I led 9 engineers", sourceIds: ["b2"] }).ok).toBe(false));
  it("flags changed bullets in the diff", () => {
    const d = buildDiff(profile, good);
    expect(d[0].changed).toBe(true);
    expect(d[0].original).toEqual(["Grew activation by 24% across 3 markets"]);
  });
});
