import { describe, expect, it } from "vitest";
import { numbersIn, unknownTerms, verifyCoverLetter, verifyTailored, vocabulary } from "@/lib/docs/verify";
import { MasterProfile, type TailoredResume } from "@/lib/types";

const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", email: "a@x.com", phone: "1", location: "Singapore", headline: "Senior Product Manager", summary: "Product manager with 6 years in fintech payments", links: [] },
  preferences: { countries: ["sg"], roles: ["Product Manager"] },
  experience: [
    { id: "exp1", company: "Acme Pay", title: "Senior Product Manager", start: "2021", end: "Present", bullets: [
      { id: "exp1.b1", text: "Grew checkout activation by 24% across 3 markets using SQL and Amplitude" },
      { id: "exp1.b2", text: "Led a team of 5 engineers and 2 designers" } ] },
    { id: "exp2", company: "Beta Labs", title: "Product Analyst", start: "2017", end: "2021", bullets: [
      { id: "exp2.b1", text: "Built Tableau dashboards used by 40 stakeholders" } ] },
  ],
  education: [{ id: "ed1", school: "NUS", degree: "BSc Economics" }],
  skills: [{ id: "s1", name: "SQL" }, { id: "s2", name: "Roadmapping" }, { id: "s3", name: "Node.js" }],
  certifications: [{ id: "c1", name: "CSPO" }],
});

const base = (over: Partial<TailoredResume["experience"][number]["bullets"][number]> = {}, exp = 0): TailoredResume => ({
  headline: "Senior Product Manager",
  summary: { text: "Product manager with 6 years in fintech payments", sourceIds: ["summary"] },
  experience: [{ experienceId: exp === 0 ? "exp1" : "exp2", bullets: [{ text: "Grew checkout activation by 24% across 3 markets", sourceIds: ["exp1.b1"], ...over }] }],
  skillIds: ["s1"], certificationIds: [], highlightIds: [],
});
const problems = (t: TailoredResume, allow: string[] = []) => verifyTailored(profile, t, allow).issues.map((i) => `${i.where}: ${i.problem}`).join(" | ");

describe("faithful output is accepted (no false alarms on normal rewrites)", () => {
  it.each([
    "Grew checkout activation by 24% across 3 markets",
    "Raised activation 24 percent in three markets",
    "Increased checkout activation across 3 markets, up 24%",
    "Used SQL and Amplitude to grow activation by 24% in 3 markets",
  ])("%s", (text) => expect(problems(base({ text }))).toBe(""));
  it("dotted and hyphenated terms from the profile are fine", () => {
    expect(unknownTerms("Built services in Node.js and node-based tooling", vocabulary(profile))).toEqual([]);
  });
  it("'I', months and weekdays are ordinary prose", () => {
    expect(unknownTerms("Since March I've shipped weekly, every Friday.", vocabulary(profile))).toEqual([]);
  });
  it("a sentence-initial ordinary word is fine", () => {
    expect(unknownTerms("Delivered the roadmap. Partnered with design.", vocabulary(profile))).toEqual([]);
  });
});

describe("invented numbers are caught in every spelling", () => {
  it.each([["Grew activation by 40% across 3 markets"], ["Grew activation by forty percent across 3 markets"], ["Grew activation by 24% across five markets"], ["Grew activation by 2,400 users across 3 markets"]])("%s", (text) => {
    expect(problems(base({ text }))).toMatch(/number\(s\) not in cited sources/);
  });
  it("numbersIn sees words, separators and percent signs", () => {
    expect(numbersIn("twenty 1,000 and 12.50%")).toEqual(["1000", "12.5", "20"]);
  });
});

describe("invented tools, employers and credentials are caught", () => {
  it.each([
    ["Grew activation 24% across 3 markets using Kubernetes"],
    ["Kubernetes migration that grew activation 24% across 3 markets"],
    ["Grew activation 24% across 3 markets while at Google"],
    ["Grew activation 24% across 3 markets as an AWS certified lead"],
    ["Grew activation 24% across 3 markets with Salesforce"],
    ["Grew activation 24% across 3 markets, mentored by McKinsey"],
  ])("%s", (text) => expect(problems(base({ text }))).toMatch(/term\(s\) not found anywhere in the candidate's profile/));

  it("allows the target company and role to be named, but nothing else", () => {
    const t = base({ text: "Grew activation 24% across 3 markets, ready to help Stripe grow" });
    expect(problems(t, ["Stripe", "Growth PM"])).toBe("");
    expect(problems(t)).toMatch(/Stripe/);
  });
});

describe("the headline cannot inflate the candidate", () => {
  it.each([["Staff Product Manager"], ["Director of Product"], ["Senior Product Manager, Kubernetes Platforms"]])("%s", (headline) => {
    expect(problems({ ...base(), headline })).toMatch(/headline uses term\(s\)/);
  });
  it("the candidate's own title, in another order, is fine", () => {
    expect(problems({ ...base(), headline: "Product Manager | Fintech" })).toBe("");
  });
});

describe("history cannot be rearranged", () => {
  it("a bullet may not describe a role it was not written for", () => {
    const t: TailoredResume = { ...base(), experience: [{ experienceId: "exp2", bullets: [{ text: "Grew checkout activation by 24% across 3 markets", sourceIds: ["exp1.b1"] }] }] };
    expect(problems(t)).toMatch(/different role \(exp1\.b1\)/);
  });
  it("a bullet may cite its own role, skills and the summary", () => {
    const t: TailoredResume = { ...base(), experience: [{ experienceId: "exp1", bullets: [{ text: "Led 5 engineers using SQL", sourceIds: ["exp1.b2", "s1"] }] }] };
    expect(problems(t)).toBe("");
  });
});

describe("cover letters", () => {
  const letter = (text: string, allow: string[] = []) => verifyCoverLetter(profile, { text, sourceIds: ["exp1.b1", "summary"] }, allow);
  it("accept a truthful letter that names the company and role", () => {
    expect(letter("I am excited about the Growth PM role at Stripe. At Acme Pay I grew activation 24% across 3 markets.", ["Stripe", "Growth PM"]).ok).toBe(true);
  });
  it("reject a claim of experience the profile lacks", () => {
    expect(letter("At Acme Pay I managed 12 engineers and shipped on Kubernetes.").ok).toBe(false);
  });
});

describe("abuse of the checker itself", () => {
  it("cannot be satisfied by citing a real fact and writing something unrelated", () => {
    expect(problems(base({ text: "Spearheaded the migration of 12 microservices to Kubernetes at Netflix" }))).toMatch(/number|term/);
  });
  it("empty and whitespace text does not crash", () => {
    expect(() => problems(base({ text: "   " }))).not.toThrow();
  });
  it("very long text finishes quickly", () => {
    const t0 = Date.now();
    problems(base({ text: "Grew activation 24% across 3 markets. ".repeat(5000) }));
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
