import { describe, expect, it } from "vitest";
import { autoOf, fillEmpty, homeCountry, inferWorkAuth, suggestCountry } from "@/lib/autofill/countries";
import { inferIndustries, topLocations } from "@/lib/autofill/industry";
import { benchmark, estimatePay, levelOf } from "@/lib/autofill/market";
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

describe("country suggestions", () => {
  it("copies target roles, infers industries and hubs, assumes sponsorship, and keeps the home-country pay as written", () => {
    const s = suggestCountry(profile(), "sg");
    expect(s.pref).toMatchObject({ titles: ["Project Manager", "Business Analyst"], locations: ["Singapore"], work_authorisation: "needs_sponsorship", currency: "SGD", salary_min: 180000 });
    expect(s.pref.salary_max).toBe(205000); // the stated figure plus 15% room, rounded to a tidy figure
    expect(s.pref.notes).toMatch(/own expected pay/);
  });
  it("estimates other countries from the market, not by plain conversion, and says so", () => {
    const india = suggestCountry(profile(), "in").pref;
    expect(india.currency).toBe("INR");
    // 180k SGD is about 13.4M INR by exchange rate alone; the market-adjusted figure is a fraction of that
    expect(india.salary_min).toBeGreaterThan(2_500_000);
    expect(india.salary_min).toBeLessThan(7_000_000);
    expect(india.notes).toMatch(/re-scaled|market/i);
    expect(india.work_authorisation).toBe("needs_sponsorship");
    expect(india.locations.length).toBeGreaterThan(2);
    expect(india.locations).toContain("Mumbai");
  });
  it("without any pay figure it still gives a benchmark-based range and says to add your own", () => {
    const s = suggestCountry(profile({}, { expectedCtc: undefined }), "au");
    expect(s.pref.salary_min).toBeGreaterThan(100_000);
    expect(s.pref.notes).toMatch(/add your expected pay/i);
  });
  it("citizenship or permanent residence named in the visa text is recognised; everything else needs sponsorship", () => {
    const p = profile({}, { visaStatus: "Indian citizen" });
    expect(inferWorkAuth(p, "in")).toBe("citizen_pr");
    expect(inferWorkAuth(p, "au")).toBe("needs_sponsorship");
    expect(inferWorkAuth(profile({}, { visaStatus: "Singapore Employment Pass (EP)" }), "sg")).toBe("needs_sponsorship");
    expect(inferWorkAuth(profile({}, { visaStatus: "Singapore PR" }), "sg")).toBe("citizen_pr");
  });
  it("home country falls back to the country in the location", () => {
    expect(homeCountry(profile({}, { payCountry: undefined }))).toBe("sg");
  });
});

describe("market-aware pay estimates", () => {
  const p = (extra: Record<string, unknown> = {}, prefs: Record<string, unknown> = {}) => profile({ experience: [{ id: "e1", company: "C", title: "Head of Delivery", start: "Mar 2010", end: "Present", bullets: [] }], ...extra }, prefs);
  it("seniority comes from years and titles", () => {
    expect(levelOf(p(), new Date("2026-06-01"))).toBe("lead");
    expect(levelOf(profile({ experience: [{ id: "e1", company: "C", title: "Analyst", start: "2024", bullets: [] }], basics: { name: "A", headline: "Analyst" } }), new Date("2026-06-01"))).toBe("junior");
  });
  it("the benchmark scales with the country's wage level", () => {
    const us = benchmark("us", "senior")!, india = benchmark("in", "senior")!;
    expect(us.usd).toBe(140000);
    expect(india.usd).toBeCloseTo(39200, -2);
    expect(india.currency).toBe("INR");
    expect(benchmark("zz", "senior")).toBeNull();
  });
  it("another country's figure is re-scaled and checked, so it stays inside the market band for the level", () => {
    for (const c of ["in", "au", "ae", "us", "ca", "gb"]) {
      const e = estimatePay(p(), c, "sg", new Date("2026-06-01"))!;
      const b = benchmark(c, "lead")!;
      expect(e.basis).toBe("scaled");
      expect(e.min).toBeGreaterThan(b.local * 0.7);
      expect(e.min).toBeLessThan(b.local * 1.4);
      expect(e.max!).toBeGreaterThanOrEqual(e.min);
    }
  });
  it("a stated range at home is kept as written and compared with the market", () => {
    const e = estimatePay(p({}, { expectedCtc: "SGD 170k - 200k" }), "sg", "sg", new Date("2026-06-01"))!;
    expect([e.min, e.max, e.basis]).toEqual([170000, 200000, "stated"]);
    expect(e.note).toMatch(/market|typical/);
  });
  it("only current pay: a typical step-up is applied and stated", () => {
    const e = estimatePay(p({}, { expectedCtc: undefined, currentCtc: "SGD 150k" }), "sg", "sg", new Date("2026-06-01"))!;
    expect(e.min).toBe(175000); // 150k plus 15%, rounded
    expect(e.note).toMatch(/step-up/);
  });
  it("an absurd expectation is pulled back into the market band abroad", () => {
    const e = estimatePay(p({}, { expectedCtc: "SGD 900k" }), "in", "sg", new Date("2026-06-01"))!;
    const b = benchmark("in", "lead")!;
    expect(e.min).toBeLessThan(b.local * 1.4);
    expect(e.note).toMatch(/ceiling/);
  });
});

describe("industries and locations", () => {
  const withText = (bullet: string, headline = "Delivery Lead") => profile({ basics: { name: "A", location: "Singapore", headline, summary: "" }, experience: [{ id: "e1", company: "Verz Design agency", title: "Delivery Lead", bullets: [{ id: "b1", text: bullet }] }] });
  it("reads the industries off the resume, strongest first", () => {
    const r = inferIndustries(withText("Led eCommerce builds on Shopify and WooCommerce for retail clients and a university portal", "Digital agency delivery leader"));
    expect(r[0]).toMatch(/Agency|eCommerce/);
    expect(r).toContain("eCommerce & Retail");
    expect(r.length).toBeLessThanOrEqual(4);
  });
  it("lists nothing when the resume gives no signal", () => {
    expect(inferIndustries(profile({ basics: { name: "A", location: "Singapore", headline: "Person", summary: "" }, experience: [{ id: "e1", company: "X", title: "Role", bullets: [] }] }))).toEqual([]);
  });
  it("hubs follow the industry: tech hubs for tech, finance hubs for finance, defaults otherwise", () => {
    expect(topLocations("in", ["SaaS & Technology"])[0]).toBe("Bengaluru");
    expect(topLocations("in", ["Fintech, Banking & Insurance"])[0]).toBe("Mumbai");
    expect(topLocations("sg", [])).toEqual(["Singapore"]);
    expect(topLocations("zz", [])).toEqual([]);
  });
});

describe("refreshing never overwrites what you changed", () => {
  const p0 = profile();
  const first = suggestCountry(p0, "in");
  const snap = autoOf(first.pref);
  it("updates fields that still hold the earlier auto-fill value", () => {
    const later = suggestCountry(profile({}, { expectedCtc: "SGD 120k" }), "in");
    const { pref, changed } = fillEmpty(first.pref, later, snap);
    expect(changed).toContain("expected salary");
    expect(pref.salary_min).toBe(later.pref.salary_min);
  });
  it("keeps a field you edited, even when the profile changed", () => {
    const edited = { ...first.pref, salary_min: 5_000_000, titles: ["My Title"] };
    const later = suggestCountry(profile({}, { expectedCtc: "SGD 200k", roles: ["Other Role"] }), "in");
    const { pref } = fillEmpty(edited, later, snap);
    expect(pref.salary_min).toBe(5_000_000);
    expect(pref.titles).toEqual(["My Title"]);
  });
  it("an entry made by an older version (no snapshot) with the auto-fill note is refreshed; one without the note is not", () => {
    const legacy = { ...defaultPref("sg", "SGD"), work_authorisation: "has_work_visa" as const, notes: "Filled in automatically from your profile on 2026-10-17; change anything." };
    expect(fillEmpty(legacy, suggestCountry(p0, "sg")).pref.work_authorisation).toBe("needs_sponsorship");
    const mine = { ...legacy, notes: "my own notes" };
    expect(fillEmpty(mine, suggestCountry(p0, "sg")).pref.work_authorisation).toBe("has_work_visa");
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
