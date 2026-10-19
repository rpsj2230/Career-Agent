import { parseProfileJson } from "@/lib/profile/json-import";
import { duplicateId } from "@/lib/profile/skills";
import { describe, expect, it } from "vitest";
import { linkedinExportToText } from "@/lib/profile/linkedin";
import { assignIds } from "@/lib/profile/ids";

describe("linkedinExportToText", () => {
  const text = linkedinExportToText({
    "Profile.csv": "First Name,Last Name,Headline,Summary,Geo Location\nAsha,Rao,Product Manager,Builds things,\"Bengaluru, India\"",
    "Positions.csv":
      "Notes:\nsomething\n\nCompany Name,Title,Description,Location,Started On,Finished On\nAcme,PM,\"Grew activation by 24%\nLed 5 engineers\",Pune,Jan 2020,",
    "Skills.csv": "Name\nSQL\nRoadmapping",
  });
  it("renders profile, positions and skills", () => {
    expect(text).toContain("Name: Asha Rao");
    expect(text).toContain("PM at Acme (Jan 2020 to Present)");
    expect(text).toContain("Grew activation by 24%");
    expect(text).toContain("SQL, Roadmapping");
  });
  it("tolerates missing files", () => expect(linkedinExportToText({})).toBe("# LinkedIn export"));
});

describe("assignIds", () => {
  const p = assignIds(
    {
      basics: { name: "A", email: "", phone: "", location: "", headline: "", summary: "", links: [], credentials: "", workStatus: "", metrics: [] },
      experience: [{ company: "Acme", title: "PM", bullets: ["one", " ", "two"] }, { company: "B", title: "APM", bullets: [] }],
      education: [{ school: "S", degree: "D" }],
      skills: [{ name: "SQL" }, { name: "sql" }, { name: "Go" }],
      certifications: [],
      highlights: ["Won a thing"], caseStudies: [], development: [], awards: [], sections: [],
      conflicts: [],
    },
    { countries: ["in"], roles: [] },
  );
  it("assigns stable unique ids", () => {
    expect(p.experience.map((e) => e.id)).toEqual(["exp1", "exp2"]);
    expect(p.experience[0].bullets.map((b) => b.id)).toEqual(["exp1.b1", "exp1.b2"]);
    expect(p.skills.map((s) => s.name)).toEqual(["SQL", "Go"]);
    expect(p.education[0].id).toBe("edu1");
  });
});

import { cleanPastedProfile, normalizeLinkedInUrl } from "@/lib/profile/linkedin";

describe("normalizeLinkedInUrl", () => {
  it("canonicalises common forms", () => {
    for (const u of ["linkedin.com/in/asha-rao", "https://in.linkedin.com/in/asha-rao/?utm_source=x", "HTTP://WWW.LINKEDIN.COM/in/asha-rao/details/experience"])
      expect(normalizeLinkedInUrl(u), u).toBe("https://www.linkedin.com/in/asha-rao");
  });
  it("rejects non-profile and look-alike links", () => {
    for (const u of ["", "https://example.com/in/asha", "https://linkedin.com.evil.com/in/asha", "https://www.linkedin.com/company/acme", "not a url", "javascript:alert(1)"])
      expect(normalizeLinkedInUrl(u), u).toBeNull();
  });
});

describe("cleanPastedProfile", () => {
  const pasted = "Asha Rao\nProduct Manager at Acme\nConnect\nMessage\nMore\n\n\n\nExperience\nSenior PM, Acme\nGrew activation 24%\nShow all 5 experiences\nPeople also viewed\nSomeone Else\nHead of Product";
  it("drops page chrome and everything after the profile", () => {
    const out = cleanPastedProfile(pasted);
    expect(out).toContain("Senior PM, Acme");
    expect(out).toContain("Grew activation 24%");
    expect(out).not.toMatch(/Connect|Message|Show all|People also viewed|Someone Else/);
    expect(out).not.toMatch(/\n{3,}/);
  });
});

describe("sloppy extraction output is read as meant", () => {
  it("accepts nulls, missing fields, numbers as text, single items and {name} objects", async () => {
    const { ExtractedProfile } = await import("@/lib/profile/ids");
    const r = ExtractedProfile.parse({
      basics: { name: "A B", email: null, phone: 12345, links: "https://linkedin.com/in/ab" },
      experience: [{ company: "Acme", title: "PM", start: 2019, end: null, bullets: ["Did x"] }, { company: "Beta", title: "Lead" }],
      education: { school: "Uni", degree: "BTech" },
      skills: [{ name: "SQL" }, "Python", ""],
    });
    expect(r.basics).toMatchObject({ name: "A B", email: "", phone: "12345", links: ["https://linkedin.com/in/ab"] });
    expect(r.experience[0]).toMatchObject({ start: "2019", end: undefined });
    expect(r.experience[1].bullets).toEqual([]);
    expect(r.education).toHaveLength(1);
    expect(r.skills).toEqual([{ name: "SQL" }, { name: "Python" }]);
    expect(r.certifications).toEqual([]);
    expect(r.conflicts).toEqual([]);
  });
  it("accepts an empty object", async () => {
    const { ExtractedProfile } = await import("@/lib/profile/ids");
    expect(ExtractedProfile.safeParse({}).success).toBe(true);
  });
});

describe("the template's own parts", () => {
  const file = JSON.stringify({
    basics: { name: "Asha Rao", metrics: ["150+ People Led", "4 Countries", " "], headline: "AI Transformation Leader · Operations Director", summary: "s" },
    experience: [{ company: "Acme", title: "PM", bullets: ["x"] }],
    caseStudies: ["Plain title", { title: "Cutting Delivery Cycles", url: "https://example.com/case" }, "plain title"],
    sections: [
      { title: "Company Brain", intro: "A paragraph.", flow: "Channels > Connectors > Agents", bullets: ["A company memory: SOPs stay.", "No label here", { label: "Built to replicate", text: "Modular." }] },
      { title: "", bullets: ["dropped"] },
    ],
  });
  const { profile } = parseProfileJson(file, { countries: [], roles: [] });
  it("keeps the headline and drops blank key figures", () => {
    expect(profile.basics.headline).toBe("AI Transformation Leader · Operations Director");
    expect(profile.basics.metrics).toEqual(["150+ People Led", "4 Countries"]);
  });
  it("keeps case study links and drops repeats", () => {
    expect(profile.caseStudies).toEqual([{ id: "cs1", title: "Plain title" }, { id: "cs2", title: "Cutting Delivery Cycles", url: "https://example.com/case" }]);
  });
  it("reads extra sections with 'Label: text' bullets and gives everything its own id", () => {
    expect(profile.sections.length).toBe(1);
    const sec = profile.sections[0];
    expect(sec).toMatchObject({ id: "sec1", title: "Company Brain", intro: "A paragraph.", flow: "Channels > Connectors > Agents" });
    expect(sec.bullets).toEqual([
      { id: "sec1.b1", label: "A company memory", text: "SOPs stay." },
      { id: "sec1.b2", text: "No label here" },
      { id: "sec1.b3", label: "Built to replicate", text: "Modular." },
    ]);
    expect(duplicateId(profile)).toBeNull();
  });
});
