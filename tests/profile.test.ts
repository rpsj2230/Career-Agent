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
      basics: { name: "A", email: "", phone: "", location: "", headline: "", summary: "", links: [] },
      experience: [{ company: "Acme", title: "PM", bullets: ["one", " ", "two"] }, { company: "B", title: "APM", bullets: [] }],
      education: [{ school: "S", degree: "D" }],
      skills: ["SQL", "sql", "Go"],
      certifications: [],
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
