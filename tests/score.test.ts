import { describe, expect, it } from "vitest";
import { buildScorePrompt, prefilter, type JobForScoring } from "@/lib/score/prompt";
import { mergeCountryConfigs } from "@/lib/country-config";
import { defaultPref } from "@/lib/country-prefs";
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
  it("does not reject an alert-email job for a short summary (the email never has more)", () => {
    expect(prefilter(job({ description: "PM at Acme, Singapore", source: "mailbox" }), profile)).toBeNull();
    expect(prefilter(job({ description: "PM at Acme, Singapore", source: "adzuna:in:PM" }), profile)).toMatch(/too short/);
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

describe("prefilter with Countries page rules", () => {
  const cfg = (o: Record<string, unknown> = {}) => mergeCountryConfigs([{ ...defaultPref("sg", "SGD"), titles: ["PM"], ...o }], [], []);
  const sg = (o: Partial<JobForScoring> = {}) => job({ country: "sg", location: "Singapore", ...o });
  it("passes a job that meets every rule", () => expect(prefilter(sg(), profile, cfg({ salary_min: 100000 }))).toBeNull());
  it("rejects countries that are not enabled, unless the job is remote", () => {
    expect(prefilter(job({ country: "in" }), profile, cfg())).toMatch(/not enabled on your Countries page/);
    expect(prefilter(job({ country: "in", location: "Remote" }), profile, cfg())).toBeNull();
  });
  it("applies remote-only and on-site-only", () => {
    expect(prefilter(sg(), profile, cfg({ remote: "remote_only" }))).toMatch(/remote roles only/);
    expect(prefilter(sg({ location: "Remote - Singapore" }), profile, cfg({ remote: "remote_only" }))).toBeNull();
    expect(prefilter(sg({ location: "Remote" }), profile, cfg({ remote: "onsite_only" }))).toMatch(/on-site roles only/);
  });
  it("rejects no-sponsorship listings only when sponsorship is needed", () => {
    const d = sg({ description: "x".repeat(100) + " We are unable to provide visa sponsorship for this role." });
    expect(prefilter(d, profile, cfg({ work_authorisation: "needs_sponsorship" }))).toMatch(/does not sponsor/);
    expect(prefilter(d, profile, cfg({ work_authorisation: "citizen_pr" }))).toBeNull();
    expect(prefilter(d, profile, cfg())).toBeNull();
  });
  it("rejects clearly low pay in the same currency, never a different currency or an estimate", () => {
    const pay = (o: Partial<JobForScoring>) => sg({ salary_min: 60000, salary_max: 80000, salary_currency: "SGD", salary_estimated: false, ...o });
    const c = cfg({ salary_min: 100000, currency: "SGD" });
    expect(prefilter(pay({}), profile, c)).toMatch(/below your minimum/);
    expect(prefilter(pay({ salary_currency: "USD" }), profile, c)).toBeNull();
    expect(prefilter(pay({ salary_estimated: true }), profile, c)).toBeNull();
    expect(prefilter(pay({ salary_max: 120000 }), profile, c)).toBeNull();
  });
  it("puts country criteria in the scoring prompt", () => {
    const p = buildScorePrompt(profile, sg(), cfg({ remote: "hybrid_ok", salary_min: 100000, locations: ["Singapore"] })[0]);
    expect(p).toContain("COUNTRY CRITERIA (SG)");
    expect(p).toContain("minimum pay: SGD 100000");
  });
});
