import { describe, expect, it } from "vitest";
import { applyPatch, carryCoverLetter, decideReuse, rankPast, type PastResume } from "@/lib/tailor/memory";
import { cosine, jaccard, jobTokens, tfidf, titleFamily, tokenize } from "@/lib/tailor/similarity";
import { tailorResumeSmart, writeCoverLetterSmart, type Runner } from "@/lib/tailor/tailor";
import { MasterProfile, type TailoredResume } from "@/lib/types";

const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", headline: "Product Manager", summary: "Product manager with 6 years in fintech payments" },
  experience: [{ id: "e1", company: "Acme Pay", title: "Product Manager", start: "2020", end: "Present", bullets: [
    { id: "e1.b1", text: "Grew checkout activation by 24% across 3 markets using SQL and Amplitude" },
    { id: "e1.b2", text: "Led a roadmap for the payments platform with engineering and design" },
    { id: "e1.b3", text: "Ran experimentation and A/B testing on onboarding flows" } ] }],
  skills: [{ id: "s1", name: "SQL" }, { id: "s2", name: "Roadmapping" }, { id: "s3", name: "Experimentation" }],
});

const JD_PAYMENTS = "Product Manager, Payments. Own the roadmap for our payments platform. Partner with engineering and design. Use SQL and experimentation to grow checkout activation. Fintech experience preferred.";
const JD_PAYMENTS_2 = "Senior Product Manager - Payments. You will own the payments platform roadmap, partner with engineering and design, and use SQL and experimentation to improve checkout activation in fintech.";
const JD_DATA_SCIENTIST = "Data Scientist. Build machine learning models in Python and Spark for fraud detection. PhD preferred. Deep learning, TensorFlow, statistics.";
const JD_PAYMENTS_EXPERIMENT = "Product Manager, Growth. Run experimentation and A/B testing across onboarding flows, own the roadmap, work with engineering and design. SQL required.";

const base: TailoredResume = {
  headline: "Product Manager",
  summary: { text: "Product manager with 6 years in fintech payments", sourceIds: ["summary"] },
  experience: [{ experienceId: "e1", bullets: [
    { text: "Grew checkout activation by 24% across 3 markets using SQL and Amplitude", sourceIds: ["e1.b1"] },
    { text: "Led a roadmap for the payments platform with engineering and design", sourceIds: ["e1.b2"] } ] }],
  skillIds: ["s1", "s2"], certificationIds: [], highlightIds: [],
};
const past = (o: Partial<PastResume> = {}): PastResume => ({ jobId: "p1", title: "Product Manager, Payments", company: "OldPay", description: JD_PAYMENTS, country: "sg", content: base, lifecycle: "none", createdAt: "2026-09-01T00:00:00Z", cover: null, ...o });
const words = new Set(tokenize("product manager fintech payments sql roadmap engineering design experimentation activation amplitude"));
const job = (title: string, description: string) => ({ id: "new", title, company: "NewCo", description });

describe("similarity", () => {
  it("tokenises, stems plurals and drops filler", () => {
    expect(tokenize("Managing the Payments platforms with SQL!")).toEqual(["managing", "payment", "platform", "sql"]);
  });
  it("close jobs score high, unrelated jobs low", () => {
    const [a, b, c] = tfidf([jobTokens({ title: "Product Manager, Payments", description: JD_PAYMENTS }), jobTokens({ title: "Senior Product Manager - Payments", description: JD_PAYMENTS_2 }), jobTokens({ title: "Data Scientist", description: JD_DATA_SCIENTIST })]);
    expect(cosine(a, b)).toBeGreaterThan(0.6);
    expect(cosine(a, c)).toBeLessThan(0.15);
  });
  it("title family ignores seniority", () => {
    expect(titleFamily("Senior Product Manager II")).toEqual(["product"]);
    expect(jaccard(titleFamily("Senior Product Manager"), titleFamily("Product Manager"))).toBe(1);
  });
});

describe("rankPast", () => {
  it("puts the closest job first and prefers roles that got a response", () => {
    const ranked = rankPast(job("Product Manager, Payments", JD_PAYMENTS_2), [past({ jobId: "ds", title: "Data Scientist", description: JD_DATA_SCIENTIST }), past({ jobId: "a", lifecycle: "none" }), past({ jobId: "b", lifecycle: "interview" })]);
    expect(ranked.map((r) => r.past.jobId)).toEqual(["b", "a", "ds"]);
  });
  it("returns nothing when there is no history", () => expect(rankPast(job("PM", "x"), [])).toEqual([]));
});

describe("decideReuse", () => {
  it("reuses for a near-identical job the old resume already covers", () => {
    const d = decideReuse(job("Product Manager, Payments", JD_PAYMENTS), [past()], profile, words);
    expect(d.mode).toBe("reuse");
  });
  it("adapts when the job is similar but stresses something the old resume leaves out", () => {
    const d = decideReuse(job("Product Manager, Growth", JD_PAYMENTS_EXPERIMENT), [past()], profile, words);
    expect(d.mode).toBe("adapt");
    expect(d.gaps).toEqual(expect.arrayContaining(["experimentation"]));
  });
  it("writes fresh for an unrelated role, even with history", () => {
    expect(decideReuse(job("Data Scientist", JD_DATA_SCIENTIST), [past()], profile, words).mode).toBe("fresh");
  });
  it("never reuses across a different role family just because the text overlaps", () => {
    const d = decideReuse(job("Marketing Manager", JD_PAYMENTS), [past()], profile, words);
    expect(d.mode).not.toBe("reuse");
  });
  it("is fresh with no history", () => expect(decideReuse(job("PM", JD_PAYMENTS), [], profile, words).mode).toBe("fresh"));
});

describe("applyPatch", () => {
  it("changes only what the patch names", () => {
    const m = applyPatch(base, { summary: { text: "New summary", sourceIds: ["summary"] }, experience: [{ experienceId: "e1", bullets: [{ text: "Ran experimentation and A/B testing on onboarding flows", sourceIds: ["e1.b3"] }] }] });
    expect(m.summary.text).toBe("New summary");
    expect(m.experience[0].bullets.map((b) => b.sourceIds[0])).toEqual(["e1.b3"]);
    expect(m.headline).toBe("Product Manager");
    expect(m.skillIds).toEqual(["s1", "s2"]);
  });
  it("an empty patch changes nothing; empty bullet lists do not wipe a role", () => {
    expect(applyPatch(base, {})).toEqual(base);
    expect(applyPatch(base, { experience: [{ experienceId: "e1", bullets: [] }] }).experience[0].bullets.length).toBe(2);
  });
});

describe("tailorResumeSmart", () => {
  const never: Runner = async () => { throw new Error("the model must not be called"); };
  const lib = (p: PastResume[], enabled = true) => ({ past: p, enabled });

  it("reuses with no model call, after verifying against the current profile", async () => {
    const r = await tailorResumeSmart(profile, job("Product Manager, Payments", JD_PAYMENTS), never, lib([past()]));
    expect(r.provenance).toMatchObject({ mode: "reused", modelCalls: 0, from: { jobId: "p1", company: "OldPay" } });
    expect(r.provenance.tokensSavedEstimate).toBeGreaterThan(500);
    expect(r.verification.ok).toBe(true);
    expect(r.model).toBe("memory");
  });

  it("will not reuse a resume that no longer verifies (the profile changed): it adapts or writes fresh instead", async () => {
    const stale = past({ content: { ...base, experience: [{ experienceId: "e1", bullets: [{ text: "Grew activation by 24% using Salesforce", sourceIds: ["e1.b1"] }] }] } });
    let calls = 0;
    const run: Runner = async (o) => { calls++; return { output: (o.system.includes("APPROVED") ? { experience: [{ experienceId: "e1", bullets: base.experience[0].bullets }] } : base) as never, model: "m" }; };
    const r = await tailorResumeSmart(profile, job("Product Manager, Payments", JD_PAYMENTS), run, lib([stale]));
    expect(r.provenance.mode).not.toBe("reused");
    expect(calls).toBeGreaterThan(0);
    expect(r.verification.ok).toBe(true);
  });

  it("adapts: the model returns only the changes and the result is verified", async () => {
    let seen = "";
    const run: Runner = async (o) => { seen = o.prompt; return { output: { experience: [{ experienceId: "e1", bullets: [{ text: "Ran experimentation and A/B testing on onboarding flows", sourceIds: ["e1.b3"] }, base.experience[0].bullets[1]] }], skillIds: ["s1", "s3"] } as never, model: "m1" }; };
    const r = await tailorResumeSmart(profile, job("Product Manager, Growth", JD_PAYMENTS_EXPERIMENT), run, lib([past()]));
    expect(r.provenance).toMatchObject({ mode: "adapted", modelCalls: 1 });
    expect(seen).toMatch(/APPROVED RESUME/);
    expect(seen).toMatch(/experimentation/);
    expect(r.content.skillIds.slice(0, 2)).toEqual(["s1", "s3"]); // the job's skills lead; the remaining skills stay so the resume does not look thin
    expect(r.content.summary.text).toBe(base.summary.text);
    expect(r.verification.ok).toBe(true);
  });

  it("adaptation that invents something is corrected on retry, and a hopeless one falls back to a fresh resume", async () => {
    let n = 0;
    const run: Runner = async (o) => {
      n++;
      if (o.system.includes("APPROVED")) return { output: { experience: [{ experienceId: "e1", bullets: [{ text: "Led 40 engineers at Google", sourceIds: ["e1.b2"] }] }] } as never, model: "m" };
      return { output: base as never, model: "m" };
    };
    const r = await tailorResumeSmart(profile, job("Product Manager, Growth", JD_PAYMENTS_EXPERIMENT), run, lib([past()]));
    expect(r.provenance.mode).toBe("fresh");
    expect(r.provenance.modelCalls).toBe(n); // 2 failed adaptations + the fresh one: all counted
    expect(r.verification.ok).toBe(true);
  });

  it("does nothing special when memory is off or empty", async () => {
    let calls = 0;
    const run: Runner = async () => { calls++; return { output: base as never, model: "m" }; };
    expect((await tailorResumeSmart(profile, job("Product Manager, Payments", JD_PAYMENTS), run, lib([past()], false))).provenance.mode).toBe("fresh");
    expect((await tailorResumeSmart(profile, job("Product Manager, Payments", JD_PAYMENTS), run, lib([]))).provenance.mode).toBe("fresh");
    expect(calls).toBeGreaterThanOrEqual(2); // at least one model call per resume; weakly-aimed answers get improvement attempts
  });
});

describe("cover letters carried between near-identical jobs", () => {
  it("switches the company and role and still has to verify", async () => {
    const carry = { text: "Dear OldPay team,\n\nI would like to apply for the Product Manager, Payments role at OldPay. I grew checkout activation by 24% across 3 markets.", fromCompany: "OldPay", fromTitle: "Product Manager, Payments", sourceIds: ["e1.b1"] };
    const r = await writeCoverLetterSmart(profile, { title: "Product Manager, Payments", company: "NewCo", description: JD_PAYMENTS }, async () => { throw new Error("no model call expected"); }, carry);
    expect(r.carried).toBe(true);
    expect(r.content.text).toContain("NewCo");
    expect(r.content.text).not.toContain("OldPay");
  });
  it("writes a fresh one when the carried text would not pass (a claim about the old company)", async () => {
    const carry = { text: "I led 40 engineers at Google.", fromCompany: "OldPay", fromTitle: "PM", sourceIds: ["e1.b1"] };
    let called = false;
    const r = await writeCoverLetterSmart(profile, { title: "PM", company: "NewCo", description: "d" }, async () => { called = true; return { output: { text: "Dear team, I grew activation 24%.", sourceIds: ["e1.b1"] } as never, model: "m" }; }, carry);
    expect(called).toBe(true);
    expect(r.carried).toBe(false);
  });
  it("carryCoverLetter replaces every occurrence", () => {
    expect(carryCoverLetter("A at X. X is great.", { company: "X", title: "A" }, { company: "Y", title: "B" })).toBe("B at Y. Y is great.");
  });
});
