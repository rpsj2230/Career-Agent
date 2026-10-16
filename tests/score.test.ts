import { describe, expect, it } from "vitest";
import { buildScorePrompt, prefilter, type JobForScoring } from "@/lib/score/prompt";
import { MasterProfile } from "@/lib/types";

const profile = MasterProfile.parse({
  basics: { headline: "PM" },
  preferences: { countries: ["in"], roles: ["Product Manager"] },
  experience: [{ id: "exp1", company: "Acme", title: "PM", start: "2020", end: "Present", bullets: [{ id: "b", text: "Grew activation 24%" }] }],
  skills: [{ id: "s", name: "SQL" }],
});
const job = (o: Partial<JobForScoring> = {}): JobForScoring => ({
  title: "PM", company: "X", country: "in", location: "Pune", description: "x".repeat(200), salary_text: null, ...o,
});

describe("prefilter", () => {
  it("passes a matching job", () => expect(prefilter(job(), profile)).toBeNull());
  it("rejects other countries unless remote", () => {
    expect(prefilter(job({ country: "us" }), profile)).toMatch(/outside your target countries/);
    expect(prefilter(job({ country: "us", location: "Remote" }), profile)).toBeNull();
  });
  it("rejects thin descriptions", () => expect(prefilter(job({ description: "short" }), profile)).toMatch(/too short/));
});

describe("buildScorePrompt", () => {
  it("includes candidate facts and truncates the JD", () => {
    const p = buildScorePrompt(profile, job({ description: "y".repeat(20000) }));
    expect(p).toContain("Skills: SQL");
    expect(p).toContain("Grew activation 24%");
    expect(p.length).toBeLessThan(7000);
  });
});
