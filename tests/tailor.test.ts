import { describe, expect, it } from "vitest";
import { tailorResume, writeCoverLetter, type Runner } from "@/lib/tailor/tailor";
import mammoth from "mammoth";
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
  skillIds: ["skill2", "skill1"], certificationIds: [],
};
const bad: TailoredResume = { ...good, experience: [{ experienceId: "exp1", bullets: [{ text: "Raised activation 60%", sourceIds: ["exp1.b1"] }] }] };

describe("tailorResume", () => {
  it("retries with feedback and accepts a corrected answer", async () => {
    const prompts: string[] = [];
    const run: Runner = async (o) => { prompts.push(o.prompt); return { output: (prompts.length === 1 ? bad : good) as never, model: "m" }; };
    const r = await tailorResume(profile, job, run);
    expect(r.verification.ok).toBe(true);
    expect(r.verification.attempts).toBe(2);
    expect(prompts[1]).toMatch(/PREVIOUS ATTEMPT WAS REJECTED[\s\S]*60/);
    expect(r.diff[0].changed).toBe(true);
  });
  it("returns a flagged result when it never verifies", async () => {
    const r = await tailorResume(profile, job, async () => ({ output: bad as never, model: "m" }));
    expect(r.verification.ok).toBe(false);
    expect(r.verification.attempts).toBe(2);
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
    expect(texts).toContain("PM  ·  Acme");
    expect(texts.indexOf("Roadmapping")).toBeLessThan(texts.indexOf("SQL"));
  });
  it("produces valid zip packages", async () => {
    for (const buf of [await renderResumeDocx(profile, good), await renderCoverLetterDocx(profile, { text: "Hello.\n\nBye.", sourceIds: [] }, "Beta")]) {
      expect(buf.subarray(0, 2).toString()).toBe("PK");
      expect(buf.length).toBeGreaterThan(1000);
    }
  });
});
