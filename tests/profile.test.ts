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
