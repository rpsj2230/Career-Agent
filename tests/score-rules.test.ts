import { describe, expect, it } from "vitest";
import { candidateYears, evidenceText, gatherEvidence, irrelevantReason, judge, requiredYears } from "@/lib/score/rules";
import { buildScorePrompt, type JobForScoring } from "@/lib/score/prompt";
import { JobScore, MasterProfile } from "@/lib/types";

const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", headline: "PM", summary: "Product manager in fintech payments" },
  preferences: { countries: ["sg"], roles: ["Product Manager"] },
  experience: [
    { id: "e1", company: "Acme Pay", title: "Senior PM", start: "2019", end: "Present", bullets: [{ id: "e1.b1", text: "Grew checkout activation by 24% using SQL and Amplitude experimentation" }, { id: "e1.b2", text: "Owned the roadmap for the payments platform with engineering and design" }] },
    { id: "e2", company: "Beta", title: "Associate Product Manager", start: "2016", end: "2019", bullets: [{ id: "e2.b1", text: "Shipped onboarding flows and ran A/B testing for lending products" }] },
  ],
  skills: [{ id: "s1", name: "SQL" }, { id: "s2", name: "Roadmapping" }, { id: "s3", name: "Amplitude" }],
});
const now = new Date("2026-06-01T00:00:00Z");
const JD_PM = "We are hiring a Senior Product Manager for our payments platform. You will own the roadmap, partner with engineering and design, use SQL and experimentation to grow checkout activation, and run A/B testing on onboarding flows in our lending products. 5+ years of product management experience required. Fintech background preferred. ".repeat(2);
const JD_NURSE = "Registered nurse needed for our hospital ward. Provide patient care, administer medication, maintain clinical records, collaborate with doctors, and ensure infection control protocols. Nursing licence and two years of clinical experience required. Shift work including nights and weekends. ".repeat(2);
const job = (title: string, description: string): JobForScoring => ({ title, company: "X", country: "sg", location: "Singapore", description, salary_text: null });
const ms = (o: Partial<JobScore> = {}): JobScore => JobScore.parse({ score: 80, matchedSkills: ["SQL"], gaps: [], summary: "ok", ...o });

describe("years", () => {
  it("reads what the posting asks for", () => {
    expect(requiredYears("5+ years of product management experience")).toBe(5);
    expect(requiredYears("minimum 8 years' relevant experience")).toBe(8);
    expect(requiredYears("We were founded 12 years ago")).toBeNull();
    expect(requiredYears("3-5 years of experience in a similar role")).toBe(5);
  });
  it("adds up experience once even when roles overlap", () => {
    expect(candidateYears(profile, now)).toBe(10);
    const overlap = MasterProfile.parse({ ...profile, experience: [{ ...profile.experience[0], start: "2020", end: "2024" }, { ...profile.experience[1], start: "2022", end: "2026" }] });
    expect(candidateYears(overlap, now)).toBe(6);
  });
});

describe("evidence", () => {
  it("scores a matching job high and shows why", () => {
    const e = gatherEvidence(profile, job("Senior Product Manager, Payments", JD_PM), now);
    expect(e.titleMatch).toBe(1);
    expect(e.score).toBeGreaterThanOrEqual(75);
    expect(e.sharedTerms).toEqual(expect.arrayContaining(["product", "activation"]));
    expect(e.missingTerms).not.toContain("product");
    expect(e.requiredYears).toBe(5);
    expect(irrelevantReason(e)).toBeNull();
  });
  it("understands that the profile's PM is a Product Manager", () => {
    expect(gatherEvidence(profile, job("Product Manager", JD_PM), now).titleMatch).toBe(1);
  });
  it("scores an unrelated job low and rejects it without a model", () => {
    const e = gatherEvidence(profile, job("Registered Nurse", JD_NURSE), now);
    expect(e.score).toBeLessThan(35);
    expect(irrelevantReason(e)).toMatch(/No overlap/);
  });
  it("never rejects on a thin posting (the figures would mean little)", () => {
    const e = gatherEvidence(profile, job("Registered Nurse", "Nurse role at hospital"), now);
    expect(e.thinPosting).toBe(true);
    expect(irrelevantReason(e)).toBeNull();
  });
  it("flags a large seniority gap", () => {
    const e = gatherEvidence(profile, job("Product Manager", `${JD_PM} 15+ years of product management experience required.`), now);
    expect(e.seniorityGap).toBe(5);
  });
});

describe("judge: the model's score is checked against the evidence", () => {
  const strong = gatherEvidence(profile, job("Senior Product Manager", JD_PM), now);
  const nurse = gatherEvidence(profile, job("Registered Nurse", JD_NURSE), now);
  it("leaves a sensible score alone", () => {
    const j = judge(ms({ score: 82 }), strong, profile);
    expect(j.score).toBe(82);
    expect(j.adjusted).toBe(false);
  });
  it("pulls an over-generous score for an unrelated job back down", () => {
    const j = judge(ms({ score: 90 }), nurse, profile);
    expect(j.score).toBeLessThanOrEqual(nurse.score + 35);
    expect(j.score).toBeLessThan(65);
    expect(j.notes.join(" ")).toMatch(/lowered/);
  });
  it("lifts an absurdly low score for a strong match", () => {
    const j = judge(ms({ score: 10 }), strong, profile);
    expect(j.score).toBeGreaterThanOrEqual(strong.score - 35);
    expect(j.notes.join(" ")).toMatch(/raised/);
  });
  it("removes skills that are not in the profile, and is stricter when most were invented", () => {
    const j = judge(ms({ score: 85, matchedSkills: ["SQL", "Kubernetes", "Terraform"] }), strong, profile);
    expect(j.output.matchedSkills).toEqual(["SQL"]);
    expect(j.notes.join(" ")).toMatch(/Kubernetes, Terraform/);
    const k = judge(ms({ score: 100, matchedSkills: ["Kubernetes", "Terraform"] }), strong, profile);
    expect(k.score).toBeLessThanOrEqual(strong.score + 20);
  });
  it("caps the score when the posting asks for far more experience than the candidate has", () => {
    const e = gatherEvidence(profile, job("Product Manager", `${JD_PM} 15+ years of product management experience required.`), now);
    expect(judge(ms({ score: 88 }), e, profile).score).toBeLessThanOrEqual(70);
  });
  it("is stable: the same input always gives the same result", () => {
    const a = judge(ms({ score: 77 }), strong, profile), b = judge(ms({ score: 77 }), strong, profile);
    expect(a).toEqual(b);
  });
  it("keeps every score within 0-100", () => {
    for (const s of [0, 50, 100]) { const j = judge(ms({ score: s }), nurse, profile); expect(j.score).toBeGreaterThanOrEqual(0); expect(j.score).toBeLessThanOrEqual(100); }
  });
});

describe("the prompt", () => {
  it("carries the evidence and the calibration scale", () => {
    const e = gatherEvidence(profile, job("Senior Product Manager", JD_PM), now);
    const p = buildScorePrompt(profile, job("Senior Product Manager", JD_PM), undefined, evidenceText(e));
    expect(p).toContain("RULE-BASED EVIDENCE");
    expect(p).toContain("Experience asked: 5 years");
  });
});
