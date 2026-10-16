import { describe, expect, it } from "vitest";
import { countryByCode, countryQueries, mergeCountryConfigs } from "@/lib/country-config";
import { defaultPref, type CountryPref } from "@/lib/country-prefs";

const pref = (o: Partial<CountryPref>): CountryPref => ({ ...defaultPref("sg", "SGD"), ...o });

describe("mergeCountryConfigs", () => {
  it("uses only the enabled configured countries, each with its own criteria", () => {
    const out = mergeCountryConfigs(
      [pref({ country: "sg", titles: ["Product Manager"], locations: ["Singapore"], remote: "hybrid_ok", salary_min: 100000, currency: "SGD", work_authorisation: "needs_sponsorship" }), pref({ country: "au", enabled: false, titles: ["PM"] }), pref({ country: "gb", titles: ["Program Manager"] })],
      ["General Role"], ["in"],
    );
    expect(out.map((c) => c.country)).toEqual(["sg", "gb"]);
    expect(out[0]).toMatchObject({ titles: ["Product Manager"], remote: "hybrid_ok", needsSponsorship: true, salary: { min: 100000, max: null, currency: "SGD" }, fallback: false });
  });
  it("falls back to the general roles when a configured country has no titles", () => {
    expect(mergeCountryConfigs([pref({ country: "sg" })], ["Product Manager", "product manager", "Analyst"], [])[0].titles).toEqual(["Product Manager", "Analyst"]);
  });
  it("with nothing configured, searches the general countries with the general roles", () => {
    const out = mergeCountryConfigs([], ["Product Manager"], ["IN", "sg", "in"]);
    expect(out.map((c) => c.country)).toEqual(["in", "sg"]);
    expect(out.every((c) => c.fallback && c.titles[0] === "Product Manager")).toBe(true);
  });
  it("searches nothing when every configured country is paused (a deliberate choice, not a fallback)", () => {
    expect(mergeCountryConfigs([pref({ enabled: false })], ["Product Manager"], ["in"])).toEqual([]);
  });
});

describe("countryQueries", () => {
  it("expands titles x locations, and uses no location when none are given", () => {
    const [cfg] = mergeCountryConfigs([pref({ titles: ["A", "B"], locations: ["X", "Y"] })], [], []);
    expect(countryQueries(cfg)).toHaveLength(4);
    expect(countryQueries(cfg)[0]).toMatchObject({ country: "sg", title: "A", location: "X" });
    const [noLoc] = mergeCountryConfigs([pref({ titles: ["A"] })], [], []);
    expect(countryQueries(noLoc)).toEqual([{ country: "sg", title: "A", location: undefined, remote: "any" }]);
  });
  it("finds a country's config by code, case-insensitively", () => {
    const list = mergeCountryConfigs([pref({ titles: ["A"] })], [], []);
    expect(countryByCode(list, "SG")?.country).toBe("sg");
    expect(countryByCode(list, "us")).toBeUndefined();
    expect(countryByCode(list, null)).toBeUndefined();
  });
});
