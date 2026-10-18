import { describe, expect, it } from "vitest";
import { balanceSkills } from "@/lib/tailor/skills";
import { MasterProfile } from "@/lib/types";

const names = ["SQL", "Python", "Tableau", "Figma", "Jira", "Roadmapping", "A/B Testing", "Google Analytics"];
const profile = MasterProfile.parse({
  basics: { name: "A", email: "a@x.com", headline: "PM", summary: "s" },
  preferences: { countries: ["in"], roles: [] },
  experience: [],
  skills: [...names.map((n, i) => ({ id: `s${i}`, name: n, kind: "technical", group: "Tools" })), { id: "x1", name: "Rust", extra: true }],
});
const job = { title: "Product Manager", description: "We use Jira and Tableau daily, plus Google Analytics for A/B Testing." };
const nameOf = (id: string) => profile.skills.find((s) => s.id === id)!.name;

describe("balanceSkills", () => {
  it("puts the skills the job names first and keeps the rest", () => {
    const out = balanceSkills(profile, ["s0"], job).map(nameOf);
    expect(out.slice(0, 4).sort()).toEqual(["A/B Testing", "Google Analytics", "Jira", "Tableau"].sort());
    expect(out.length).toBeGreaterThanOrEqual(Math.ceil(names.length * 0.75));
    expect(out).toContain("SQL");
  });
  it("never invents skills or prints extras that were not chosen", () => {
    const out = balanceSkills(profile, ["s0", "nonsense"], job);
    expect(out.every((id) => profile.skills.some((s) => s.id === id))).toBe(true);
    expect(out).not.toContain("x1");
    expect(new Set(out).size).toBe(out.length);
  });
  it("respects a larger choice by the model", () => {
    expect(balanceSkills(profile, names.map((_, i) => `s${i}`), job)).toHaveLength(names.length);
  });
});
