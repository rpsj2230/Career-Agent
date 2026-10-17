import { describe, expect, it } from "vitest";
import { buildAnswers } from "@/lib/apply/answers";
import { countryAnswers } from "@/lib/country-prefs";
import { countryLabel } from "@/lib/filters";

const sg = { country: "sg", salary_min: 120000, salary_max: 150000, currency: "SGD", work_authorisation: "needs_sponsorship" } as const;
const prefs = { countries: [], roles: [], expectedCtc: "30 LPA", visaStatus: "Indian citizen", relocate: true };

describe("country-specific answers", () => {
  it("expresses expected salary in that country's currency and the right authorisation", () => {
    const a = countryAnswers(sg);
    expect(a[0]).toMatchObject({ question: "Expected salary (SGD, per year)", answer: "SGD 120,000 - 150,000 per year" });
    expect(a.find((x) => /sponsorship/.test(x.question))?.answer).toBe("Yes");
    expect(a.find((x) => /Work authorisation/.test(x.question))?.answer).toBe("I need employer visa sponsorship");
  });
  it("says no sponsorship is needed for a citizen or permanent resident", () => {
    expect(countryAnswers({ ...sg, work_authorisation: "citizen_pr" }).find((x) => /sponsorship/.test(x.question))?.answer).toBe("No");
  });
  it("offers nothing when the country has no salary or authorisation set", () => {
    expect(countryAnswers({ country: "de", salary_min: null, salary_max: null, currency: null, work_authorisation: null })).toEqual([]);
    expect(countryAnswers(undefined)).toEqual([]);
  });
  it("a single figure is not shown as a range", () => {
    expect(countryAnswers({ ...sg, salary_max: null })[0].answer).toBe("SGD 120,000 per year");
  });
  it("beats the general answers, but never your own answer bank", () => {
    const got = buildAnswers([], prefs, undefined, countryAnswers(sg));
    expect(got.find((a) => /salary/i.test(a.question))?.answer).toMatch(/^SGD/);
    expect(got.find((a) => /Expected CTC/.test(a.question))).toBeUndefined();
    expect(got.find((a) => /Work authorisation/.test(a.question))?.answer).toBe("I need employer visa sponsorship");
    const banked = buildAnswers([{ question: "Expected salary", answer: "Negotiable" }], prefs, undefined, countryAnswers(sg));
    expect(banked.filter((a) => /salary/i.test(a.question)).map((a) => a.answer)).toEqual(["Negotiable"]);
  });
  it("without a country entry the general answers are used as before", () => {
    expect(buildAnswers([], prefs).find((a) => /Expected CTC/.test(a.question))?.answer).toBe("30 LPA");
  });
  it("names every country that can be added", () => {
    expect(countryLabel("kr")).toBe("South Korea");
    expect(countryLabel("zz")).toBe("ZZ");
  });
});
