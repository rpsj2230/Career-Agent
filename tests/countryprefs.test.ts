import { describe, expect, it } from "vitest";
import { CountryPrefInput, dedupeList, defaultPref, needsSponsorship, parseList, queriesPerSource } from "@/lib/country-prefs";

const base = { country: "sg" };

describe("CountryPrefInput", () => {
  it("fills sensible defaults", () => {
    expect(CountryPrefInput.parse(base)).toMatchObject({ country: "sg", enabled: true, titles: [], remote: "any", salary_min: null, currency: null, work_authorisation: null });
  });
  it("accepts a complete configuration", () => {
    const p = CountryPrefInput.parse({ ...base, titles: ["Product Manager"], industries: ["Fintech"], locations: ["Singapore"], remote: "hybrid_ok", salary_min: 100000, salary_max: 150000, currency: "SGD", work_authorisation: "needs_sponsorship", notes: "Prefer EP sponsors" });
    expect(p.salary_max).toBe(150000);
  });
  it("rejects a minimum above the maximum and salary figures without a currency", () => {
    expect(CountryPrefInput.safeParse({ ...base, salary_min: 9, salary_max: 3, currency: "SGD" }).success).toBe(false);
    const noCur = CountryPrefInput.safeParse({ ...base, salary_min: 5000 });
    expect(noCur.success).toBe(false);
    expect(!noCur.success && noCur.error.issues[0].message).toMatch(/currency/i);
  });
  it("rejects malformed codes, currencies and enum values", () => {
    for (const bad of [{ country: "SGP" }, { country: "S" }, { ...base, currency: "sgd" }, { ...base, remote: "maybe" }, { ...base, work_authorisation: "whatever" }, { ...base, salary_min: -1, currency: "SGD" }, { ...base, titles: ["x".repeat(81)] }]) {
      expect(CountryPrefInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(CountryPrefInput.safeParse({ ...base, titles: Array.from({ length: 61 }, (_, i) => `Role ${i}`) }).success).toBe(false);
    expect(CountryPrefInput.safeParse({ ...base, titles: Array.from({ length: 60 }, (_, i) => `Role ${i}`) }).success).toBe(true);
  });
});

describe("list helpers", () => {
  it("parses commas, semicolons and new lines, dropping blanks and case-insensitive duplicates", () => {
    expect(parseList("Product Manager, product manager;\nProgram Manager,, ")).toEqual(["Product Manager", "Program Manager"]);
    expect(dedupeList([" A ", "a", "B"])).toEqual(["A", "B"]);
  });
  it("counts the searches a country causes", () => {
    expect(queriesPerSource({ titles: [], locations: [] })).toBe(1);
    expect(queriesPerSource({ titles: ["a", "b", "c"], locations: ["x", "y"] })).toBe(6);
    expect(queriesPerSource({ titles: ["a"], locations: [] })).toBe(1);
  });
});

describe("work authorisation", () => {
  it("derives whether sponsorship is needed", () => {
    expect(needsSponsorship("needs_sponsorship")).toBe(true);
    expect(needsSponsorship("not_authorised")).toBe(true);
    expect(needsSponsorship("citizen_pr")).toBe(false);
    expect(needsSponsorship("has_work_visa")).toBe(false);
    expect(needsSponsorship(null)).toBeNull();
  });
  it("builds a default row with the country currency", () => expect(defaultPref("au", "AUD")).toMatchObject({ country: "au", currency: "AUD", enabled: true }));
});
