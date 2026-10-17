import { describe, expect, it } from "vitest";
import { applyScope, DEFAULT_SCOPE, SAMPLE_PROFILE } from "@/lib/tailor/scope";
import { masterAsTailored, resumeView } from "@/lib/tailor/sections";
import type { TailoredResume } from "@/lib/types";

const tailored: TailoredResume = {
  headline: "Senior Product Manager, Payments",
  summary: { text: "Payments-focused product manager.", sourceIds: ["exp1.b1"] },
  experience: [{ experienceId: "exp1", bullets: [{ text: "Led the roadmap for a product used by thousands of customers.", sourceIds: ["exp1.b1"] }] }],
  skillIds: ["skill3", "skill1"],
  certificationIds: ["cert1"], highlightIds: [],
};

describe("tailoring scope", () => {
  it("changes nothing when everything may change", () => expect(applyScope(tailored, SAMPLE_PROFILE, DEFAULT_SCOPE)).toBe(tailored));
  it("puts back each locked part from the master resume and keeps the rest", () => {
    const m = masterAsTailored(SAMPLE_PROFILE);
    const r = applyScope(tailored, SAMPLE_PROFILE, { headline: false, summary: true, highlights: true, bullets: false, skills: true });
    expect(r.headline).toBe(m.headline);
    expect(r.summary).toEqual(tailored.summary);
    expect(r.experience).toEqual(m.experience);
    expect(r.skillIds).toEqual(["skill3", "skill1"]);
    const all = applyScope(tailored, SAMPLE_PROFILE, { headline: false, summary: false, highlights: false, bullets: false, skills: false });
    expect(all).toMatchObject({ headline: m.headline, summary: m.summary, experience: m.experience, skillIds: m.skillIds });
  });
  it("employers, titles and dates are always the profile's, whatever is tailored", () => {
    const v = resumeView(SAMPLE_PROFILE, tailored);
    expect(v.experience[0]).toMatchObject({ company: "Latest Company", title: "Senior Product Manager", dates: "Jan 2022 - Present" });
  });
  it("the sample shows a complete resume", () => {
    const v = resumeView(SAMPLE_PROFILE, masterAsTailored(SAMPLE_PROFILE));
    expect(v.experience).toHaveLength(2);
    expect(v.competencies.flatMap((g) => g.items).length + v.technical.flatMap((g) => g.items).length + v.skills.length).toBeGreaterThan(3);
    expect(v.highlights.length).toBeGreaterThan(0);
    expect(v.education).toHaveLength(1);
  });
});
