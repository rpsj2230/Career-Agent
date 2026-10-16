import { describe, expect, it } from "vitest";
import { annualise, compareSalary, normalizeSalary, parseSalaryText } from "@/lib/salary";
import { COUNTRIES, countryInfo, defaultCurrency } from "@/lib/countries";

describe("parseSalaryText", () => {
  it("parses ranges with currency codes, commas and periods", () => {
    expect(parseSalaryText("SGD 8,000 - 10,000 per month")).toEqual({ min: 8000, max: 10000, currency: "SGD", period: "month" });
    expect(parseSalaryText("AUD 120,000 – 150,000 a year")).toEqual({ min: 120000, max: 150000, currency: "AUD", period: "year" });
  });
  it("understands Indian formats: LPA, lakh, crore", () => {
    expect(parseSalaryText("24-32 LPA")).toEqual({ min: 2_400_000, max: 3_200_000, currency: "INR", period: "year" });
    expect(parseSalaryText("₹ 18 lakh per annum")).toMatchObject({ min: 1_800_000, max: 1_800_000, currency: "INR", period: "year" });
    expect(parseSalaryText("1.5 crore")).toMatchObject({ min: 15_000_000, currency: "INR" });
  });
  it("understands k and m suffixes, including a shared suffix on a range", () => {
    expect(parseSalaryText("$120k-150k")).toMatchObject({ min: 120_000, max: 150_000, currency: "USD" });
    expect(parseSalaryText("£45k")).toMatchObject({ min: 45_000, max: 45_000, currency: "GBP" });
    expect(parseSalaryText("$120-150k")).toMatchObject({ min: 120_000, max: 150_000 });
    expect(parseSalaryText("1.2m")).toMatchObject({ min: 1_200_000 });
  });
  it("resolves ambiguous dollar signs with the country's currency, not by guessing USD", () => {
    expect(parseSalaryText("$9,000 per month", "SGD")).toMatchObject({ currency: "SGD" });
    expect(parseSalaryText("$9,000 per month", "INR")?.currency).toBe("USD");
    expect(parseSalaryText("S$7,000")).toMatchObject({ currency: "SGD" });
    expect(parseSalaryText("A$100,000")).toMatchObject({ currency: "AUD" });
  });
  it("falls back to the default currency only when the text does not say", () => {
    expect(parseSalaryText("80,000 - 95,000", "GBP")).toMatchObject({ currency: "GBP", min: 80000, max: 95000 });
    expect(parseSalaryText("80,000")?.currency).toBeUndefined();
  });
  it("returns null when there is nothing numeric", () => {
    for (const t of ["Competitive", "", null, undefined, "DOE"]) expect(parseSalaryText(t as string), String(t)).toBeNull();
  });
  it("orders min and max", () => expect(parseSalaryText("10,000 to 8,000 SGD")).toMatchObject({ min: 8000, max: 10000 }));
});

describe("annualise / normalizeSalary", () => {
  it("converts periods to a year", () => {
    expect(annualise(8000, "month")).toBe(96000);
    expect(annualise(50, "hour")).toBe(104000);
    expect(annualise(100, "day")).toBe(26000);
    expect(annualise(70000, null)).toBe(70000);
  });
  it("normalises to annual figures and uses the country currency when missing", () => {
    expect(normalizeSalary({ min: 8000, max: 10000, currency: "SGD", period: "month" })).toEqual({ min: 96000, max: 120000, currency: "SGD" });
    expect(normalizeSalary({ min: 90000, max: 110000, period: "year" }, "sg")).toEqual({ min: 90000, max: 110000, currency: "SGD" });
    expect(normalizeSalary(null)).toEqual({ min: null, max: null, currency: null });
  });
});

describe("compareSalary", () => {
  const pref = { min: 100000, max: 150000, currency: "SGD" };
  it("rejects only a clear miss in the same currency", () => {
    expect(compareSalary({ min: 60000, max: 80000, currency: "SGD" }, pref)).toMatchObject({ verdict: "below" });
    expect(compareSalary({ min: 60000, max: 80000, currency: "SGD" }, pref).note).toContain("SGD 80,000");
  });
  it("accepts when the top of the range reaches your minimum", () => {
    expect(compareSalary({ min: 90000, max: 110000, currency: "SGD" }, pref).verdict).toBe("ok");
    expect(compareSalary({ min: 120000, currency: "SGD" }, pref).verdict).toBe("ok");
  });
  it("flags pay above your maximum without rejecting", () => expect(compareSalary({ min: 200000, max: 250000, currency: "SGD" }, pref).verdict).toBe("above"));
  it("never decides across currencies, on estimates, or without data", () => {
    expect(compareSalary({ min: 10, max: 20, currency: "USD" }, pref).verdict).toBe("unknown");
    expect(compareSalary({ min: 10, max: 20, currency: "SGD", estimated: true }, pref).verdict).toBe("unknown");
    expect(compareSalary({ currency: "SGD" }, pref).verdict).toBe("unknown");
    expect(compareSalary({ min: 10, currency: null }, pref).verdict).toBe("unknown");
    expect(compareSalary({ min: 10, currency: "SGD" }, { currency: "SGD" }).verdict).toBe("unknown");
  });
});

describe("country catalogue", () => {
  it("has unique codes, 3-letter currencies, and the requested countries", () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) expect(c.currency).toMatch(/^[A-Z]{3}$/);
    for (const code of ["sg", "au", "gb", "us", "in"]) expect(countryInfo(code), code).toBeTruthy();
    expect(defaultCurrency("SG")).toBe("SGD");
    expect(defaultCurrency("zz")).toBeUndefined();
  });
});
