import { describe, expect, it } from "vitest";
import { fillEmpty, homeCountry, inferWorkAuth, suggestCountry } from "@/lib/autofill/countries";
import { convertAmount, parseAmount } from "@/lib/autofill/money";
import { fillPreferences, rolesFromExperience } from "@/lib/autofill/preferences";
import { defaultPref } from "@/lib/country-prefs";
import { MasterProfile } from "@/lib/types";

const profile = (over: Record<string, unknown> = {}, prefs: Record<string, unknown> = {}) => MasterProfile.parse({
  basics: { name: "A", location: "Singapore", headline: "Delivery Lead", workStatus: "Employment Pass (EP)" },
  preferences: { countries: ["sg", "in", "au"], roles: ["Project Manager", "Business Analyst"], payCountry: "sg", visaStatus: "Singapore Employment Pass (EP)", expectedCtc: "SGD 180k", ...prefs },
  experience: [{ id: "exp1", company: "C", title: "Delivery & Operations Lead", bullets: [] }, { id: "exp2", company: "C", title: "Senior Project Manager | Business Analyst, Enterprise Team", bullets: [] }],
  ...over,
});

describe("reading pay figures", () => {
  const cases: [string, string | null, [number, number | null, string] | null][] = [
    ["32 LPA", null, [3_200_000, null, "INR"]],
    ["₹32 lakh per annum", null, [3_200_000, null, "INR"]],
    ["12 LPA - 15 LPA", null, [1_200_000, 1_500_000, "INR"]],
    ["S$180,000", null, [180000, null, "SGD"]],
    ["SGD 15k per month", null, [180000, null, "SGD"]],
    ["$150-170k", "AUD", [150000, 170000, "AUD"]],
    ["$150-170k", null, [150000, 170000, "USD"]],
    ["AED 40,000 per month", null, [480000, null, "AED"]],
    ["32", "INR", [3_200_000, null, "INR"]],
    ["180000", "SGD", [180000, null, "SGD"]],
    ["negotiable", "SGD", null],
    ["", "SGD", null],
    ["12", "SGD", null],
  ];
  for (const [text, fb, want] of cases) it(`"${text}" (${fb ?? "no default"})`, () => {
    const a = parseAmount(text, fb);
    expect(a ? [a.min, a.max, a.currency] : null).toEqual(want);
  });
  it("converts at approximate rates and rounds tidily", () => {
    const sgd = convertAmount({ min: 180000, max: null, currency: "SGD" }, "AUD")!;
    expect(sgd.currency).toBe("AUD");
    expect(sgd.min).toBeGreaterThan(190000); expect(sgd.min).toBeLessThan(215000);
    expect(sgd.min % 5000).toBe(0);
    expect(convertAmount({ min: 1, max: null, currency: "XXX" }, "AUD")).toBeNull();
  });
});

describe("country suggestions come only from what the profile says", () => {
  it("copies target roles, location and visa-based authorisation for the home country, and keeps the expected pay as written", () => {
    const s = suggestCountry(profile(), "sg");
    expect(s.pref).toMatchObject({ titles: ["Project Manager", "Business Analyst"], locations: ["Singapore"], work_authorisation: "has_work_visa", currency: "SGD", salary_min: 180000, salary_max: null });
    expect(s.pref.notes).toMatch(/automatically/);
    expect(s.pref.notes).not.toMatch(/estimate/);
  });
  it("converts the pay for other countries, labels it an estimate and does not guess authorisation or city", () => {
    const s = suggestCountry(profile(), "in");
    expect(s.pref.currency).toBe("INR");
    expect(s.pref.salary_min).toBeGreaterThan(8_000_000);
    expect(s.pref.notes).toMatch(/estimate/i);
    expect(s.pref.work_authorisation).toBeNull();
    expect(s.pref.locations).toEqual([]);
  });
  it("leaves the salary empty when the profile has no expected pay", () => {
    const s = suggestCountry(profile({}, { expectedCtc: undefined }), "au");
    expect(s.pref.salary_min).toBeNull();
    expect(s.pref.titles).toHaveLength(2);
  });
  it("citizenship named in the visa text is recognised, and nothing else is guessed", () => {
    const p = profile({}, { visaStatus: "Indian citizen" });
    expect(inferWorkAuth(p, "in")).toBe("citizen_pr");
    expect(inferWorkAuth(p, "au")).toBeNull();
    expect(inferWorkAuth(profile({}, { visaStatus: "" }), "sg")).toBeNull();
  });
  it("home country falls back to the country in the location", () => {
    expect(homeCountry(profile({}, { payCountry: undefined }))).toBe("sg");
  });
});

describe("filling never overwrites", () => {
  const s = suggestCountry(profile(), "sg");
  it("fills only empty fields", () => {
    const existing = { ...defaultPref("sg", "SGD"), titles: ["My Own Title"], salary_min: 200000 };
    const { pref, changed } = fillEmpty(existing, s);
    expect(pref.titles).toEqual(["My Own Title"]);
    expect(pref.salary_min).toBe(200000);
    expect(pref.locations).toEqual(["Singapore"]);
    expect(pref.work_authorisation).toBe("has_work_visa");
    expect(changed).toEqual(["locations", "work authorisation"]);
  });
  it("changes nothing when everything is already set", () => {
    const full = { ...s.pref, notes: "mine" };
    const { pref, changed } = fillEmpty(full, s);
    expect(changed).toEqual([]);
    expect(pref).toEqual(full);
  });
});

describe("profile preferences defaults", () => {
  it("derives roles from recent titles", () => {
    expect(rolesFromExperience(profile())).toEqual(["Delivery & Operations Lead", "Senior Project Manager", "Business Analyst"]);
  });
  it("fills only empty preferences", () => {
    const p = profile({}, { roles: [], countries: [], payCountry: undefined, visaStatus: undefined });
    const { preferences, filled } = fillPreferences(p);
    expect(preferences.roles.length).toBeGreaterThan(0);
    expect(preferences.countries).toEqual(["sg"]);
    expect(preferences.payCountry).toBe("sg");
    expect(preferences.visaStatus).toBe("Employment Pass (EP) (SG)");
    expect(filled).toEqual(["target roles", "target countries", "pay country", "work authorisation"]);
    expect(fillPreferences(profile()).filled).toEqual([]);
  });
});
