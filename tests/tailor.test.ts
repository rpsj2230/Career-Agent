import { describe, expect, it } from "vitest";
import { tailorResume, writeCoverLetter, type Runner } from "@/lib/tailor/tailor";
import mammoth from "mammoth";
import { assessTailoring } from "@/lib/tailor/quality";
import { renderCoverLetterDocx, renderResumeDocx } from "@/lib/tailor/docx";
import { MasterProfile, type TailoredResume } from "@/lib/types";

const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", email: "a@x.com", headline: "Product Manager", summary: "PM with 6 years" },
  preferences: { countries: ["in"], roles: [] },
  experience: [{ id: "exp1", company: "Acme", title: "PM", start: "2020", end: "Present", bullets: [{ id: "exp1.b1", text: "Grew activation by 24%" }] }],
  skills: [{ id: "skill1", name: "SQL" }, { id: "skill2", name: "Roadmapping" }],
});
const job = { title: "Senior PM", company: "Beta", description: "d".repeat(100) };

const good: TailoredResume = {
  headline: "Product Manager", summary: { text: "PM with 6 years", sourceIds: ["summary"] },
  experience: [{ experienceId: "exp1", bullets: [{ text: "Raised activation 24%", sourceIds: ["exp1.b1"] }] }],
  skillIds: ["skill2", "skill1"], certificationIds: [], highlightIds: [],
};
const bad: TailoredResume = { ...good, experience: [{ experienceId: "exp1", bullets: [{ text: "Raised activation 60%", sourceIds: ["exp1.b1"] }] }] };

describe("tailorResume", () => {
  it("retries with feedback and accepts a corrected answer", async () => {
    const prompts: string[] = [];
    const run: Runner = async (o) => { prompts.push(o.prompt); return { output: (prompts.length === 1 ? bad : good) as never, model: "m" }; };
    const r = await tailorResume(profile, job, run);
    expect(r.verification.ok).toBe(true);
    expect(r.verification.attempts).toBeGreaterThanOrEqual(2);
    expect(prompts[1]).toMatch(/PREVIOUS ATTEMPT WAS REJECTED[\s\S]*60/);
    expect(r.diff[0].changed).toBe(true);
  });
  it("returns a flagged result when it never verifies", async () => {
    const r = await tailorResume(profile, job, async () => ({ output: bad as never, model: "m" }));
    expect(r.verification.ok).toBe(false);
    expect(r.verification.attempts).toBe(3);
  });
});

describe("tailoring quality", () => {
  const rich = MasterProfile.parse({
    basics: { name: "Asha Rao", email: "a@x.com", headline: "Product Manager", summary: "Product manager with six years of experience in payments." },
    preferences: { countries: ["in"], roles: [] },
    experience: [{ id: "exp1", company: "Acme", title: "Product Manager", start: "2020", end: "Present", bullets: [
      { id: "exp1.b1", text: "Grew checkout activation by 24% using SQL funnel analysis and A/B testing" },
      { id: "exp1.b2", text: "Managed the payments roadmap with engineering and design" },
    ] }],
    skills: [{ id: "skill1", name: "SQL" }, { id: "skill2", name: "Roadmapping" }, { id: "skill3", name: "A/B testing" }],
  });
  const pjob = { title: "Senior Product Manager, Payments", company: "Beta", description: "We need a product manager to own the payments roadmap, run A/B testing and SQL funnel analysis to improve checkout activation. ".repeat(3) };
  const lazy: TailoredResume = {
    headline: "Product Manager", summary: { text: "Product manager with six years of experience in payments.", sourceIds: ["summary"] },
    experience: [{ experienceId: "exp1", bullets: [{ text: "Grew checkout activation by 24% using SQL funnel analysis and A/B testing", sourceIds: ["exp1.b1"] }, { text: "Managed the payments roadmap with engineering and design", sourceIds: ["exp1.b2"] }] }],
    skillIds: ["skill1"], certificationIds: [], highlightIds: [],
  };
  const aimed: TailoredResume = {
    headline: "Product Manager, Payments", summary: { text: "Product manager owning the payments roadmap, using SQL funnel analysis and A/B testing to raise checkout activation by 24%.", sourceIds: ["summary", "exp1.b1"] },
    experience: [{ experienceId: "exp1", bullets: [{ text: "Raised checkout activation 24% through SQL funnel analysis and A/B testing", sourceIds: ["exp1.b1"] }, { text: "Owned the payments roadmap, aligning engineering and design", sourceIds: ["exp1.b2"] }] }],
    skillIds: ["skill1", "skill2", "skill3"], certificationIds: [], highlightIds: [],
  };

  it("scores a master-like resume low and says what to fix, and an aimed one high", () => {
    const l = assessTailoring(rich, lazy, pjob), a = assessTailoring(rich, aimed, pjob);
    expect(l.headlineTailored).toBe(false);
    expect(l.bulletsRewritten).toBe(0);
    expect(l.problems.length).toBeGreaterThanOrEqual(3);
    expect(a.headlineTailored).toBe(true);
    expect(a.summaryTailored).toBe(true);
    expect(a.bulletsRewritten).toBe(2);
    expect(a.score).toBeGreaterThan(l.score + 30);
    expect(a.keywordCoverage).toBeGreaterThanOrEqual(l.keywordCoverage);
  });
  it("reports job terms the profile cannot support as gaps and never as something to add", () => {
    const q = assessTailoring(rich, aimed, { title: "Product Manager", description: "Kubernetes terraform payments roadmap ".repeat(5) });
    expect(q.gaps).toEqual(expect.arrayContaining(["kubernete", "terraform"]));
    expect(q.missing).not.toContain("kubernete");
  });
  it("asks again with the specific problems when the answer is valid but not tailored, and keeps the better one", async () => {
    const prompts: string[] = [];
    const r = await tailorResume(rich, pjob, async (o) => { prompts.push(o.prompt); return { output: (prompts.length === 1 ? lazy : aimed) as never, model: "m" }; });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toMatch(/NOT TAILORED ENOUGH[\s\S]*headline/);
    expect(r.content.headline).toBe("Product Manager, Payments");
    expect(r.quality.score).toBeGreaterThan(75);
  });
  it("does not ask again once the first answer is well aimed", async () => {
    let calls = 0;
    await tailorResume(rich, pjob, async () => { calls++; return { output: aimed as never, model: "m" }; });
    expect(calls).toBe(1);
  });
  it("keeps the best valid answer when improvement attempts are no better", async () => {
    let n = 0;
    const r = await tailorResume(rich, pjob, async () => { n++; return { output: (n === 1 ? aimed : lazy) as never, model: "m" }; });
    expect(r.content.headline).toBe("Product Manager, Payments");
  });
});

describe("writeCoverLetter", () => {
  it("flags invented numbers", async () => {
    const r = await writeCoverLetter(profile, job, async () => ({ output: { text: "I grew it 99%", sourceIds: ["exp1.b1"] } as never, model: "m" }));
    expect(r.verification.ok).toBe(false);
  });
});

describe("docx", () => {
  it("takes company and dates from the profile and orders skills as tailored", async () => {
    const texts = (await mammoth.extractRawText({ buffer: await renderResumeDocx(profile, good) })).value;
    expect(texts).toContain("PM, Acme");
    expect(texts.indexOf("Roadmapping")).toBeLessThan(texts.indexOf("SQL"));
  });
  it("produces valid zip packages", async () => {
    for (const buf of [await renderResumeDocx(profile, good), await renderCoverLetterDocx(profile, { text: "Hello.\n\nBye.", sourceIds: [] }, "Beta")]) {
      expect(buf.subarray(0, 2).toString()).toBe("PK");
      expect(buf.length).toBeGreaterThan(1000);
    }
  });
});
