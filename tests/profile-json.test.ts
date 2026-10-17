import { describe, expect, it } from "vitest";
import { parseProfileJson } from "@/lib/profile/json-import";

const prefs = { countries: [], roles: [] };
const file = {
  basics: { name: "A B", email: "a@b.com", phone: "+65 1", location: "Singapore", headline: "Delivery Lead", summary: "S", links: ["linkedin.com/in/ab"] },
  experience: [{ company: "Acme", title: "Lead", location: "Singapore", start: "Jul 2020", end: "Present", bullets: ["Did x", "Did y"] }],
  education: [{ school: "Uni", degree: "MBA", start: "2013", end: "2015" }],
  skills: ["SQL", "Jira"], certifications: ["PMP"],
  preferences: { countries: ["IN", "sg"], roles: ["Project Manager"], payCountry: "sg", visaStatus: "Employment Pass", relocate: true },
};

describe("ready-made profile file", () => {
  it("becomes a profile with ids and the given preferences", () => {
    const { profile } = parseProfileJson(JSON.stringify(file), { countries: ["us"], roles: [], noticePeriod: "60 days" });
    expect(profile.basics.name).toBe("A B");
    expect(profile.experience[0]).toMatchObject({ id: "exp1", company: "Acme" });
    expect(profile.experience[0].bullets.map((b) => b.id)).toEqual(["exp1.b1", "exp1.b2"]);
    expect(profile.skills.map((s) => s.name)).toEqual(["SQL", "Jira"]);
    expect(profile.preferences).toMatchObject({ countries: ["in", "sg"], roles: ["Project Manager"], payCountry: "sg", visaStatus: "Employment Pass", relocate: true, noticePeriod: "60 days" });
  });
  it("keeps existing preferences the file does not mention", () => {
    const { preferences, ...rest } = file;
    void preferences;
    expect(parseProfileJson(JSON.stringify(rest), { countries: ["us"], roles: ["X"] }).profile.preferences.countries).toEqual(["us"]);
  });
  it("rejects text that is not JSON or not a profile", () => {
    expect(() => parseProfileJson("not json", prefs)).toThrow(/not valid JSON/);
    expect(() => parseProfileJson("{}", prefs)).toThrow(/does not look like a profile/);
  });
});
