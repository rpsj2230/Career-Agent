import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { buildJobSnapshot, buildProfileSnapshot } from "@/lib/apply/snapshot";
import { STYLES } from "@/lib/tailor/template";
import { renderResumeDocx } from "@/lib/tailor/docx";
import { masterAsTailored, resumeText, resumeView } from "@/lib/tailor/sections";
import { MasterProfile } from "@/lib/types";

const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", email: "asha@example.com", phone: "+65 8000 0000", location: "Singapore", headline: "Product Manager", summary: "PM with 6 years", links: ["https://linkedin.com/in/asha"] },
  preferences: { countries: ["sg"], roles: ["Product Manager"] },
  experience: [
    { id: "exp1", company: "Acme", title: "Product Manager", start: "2020", end: "Present", location: "Singapore", bullets: [{ id: "exp1.b1", text: "Grew activation 24%" }, { id: "exp1.b2", text: "Led a team of 5" }] },
    { id: "exp2", company: "Beta", title: "Analyst", start: "2017", end: "2020", bullets: [{ id: "exp2.b1", text: "Built dashboards" }] },
  ],
  education: [{ id: "ed1", school: "NUS", degree: "BSc", start: "2013", end: "2017" }],
  skills: [{ id: "s1", name: "SQL" }, { id: "s2", name: "Roadmapping" }],
  certifications: [{ id: "c1", name: "CSPO" }],
});

describe("resume view", () => {
  const tailored = { headline: "Senior PM", summary: { text: "Tailored summary", sourceIds: ["summary"] }, experience: [{ experienceId: "exp1", bullets: [{ text: "Grew activation 24%", sourceIds: ["exp1.b1"] }] }], skillIds: ["s1"], certificationIds: [], highlightIds: [] };

  it("takes company, title and dates from the profile and keeps only what was selected", () => {
    const v = resumeView(profile, tailored);
    expect(v.experience).toEqual([{ title: "Product Manager", company: "Acme", dates: "", location: "Singapore", bullets: ["Grew activation 24%"], employer: { name: "Acme", location: "Singapore", dates: "2020 – Present", roles: 1 } }]);
    expect(v.skills).toEqual(["SQL"]);
    expect(v.headline).toBe("Senior PM");
  });
  it("drops experience ids that are not in the profile instead of inventing a job", () => {
    expect(resumeView(profile, { ...tailored, experience: [{ experienceId: "nope", bullets: [{ text: "x", sourceIds: [] }] }] }).experience).toEqual([]);
  });
  it("the original lays out the whole master profile without rewording anything", () => {
    const v = resumeView(profile, masterAsTailored(profile));
    expect(v.summary).toBe("PM with 6 years");
    expect(v.experience.map((e) => e.bullets)).toEqual([["Grew activation 24%", "Led a team of 5"], ["Built dashboards"]]);
    expect(v.skills).toEqual(["SQL", "Roadmapping"]);
    expect(v.certifications).toEqual(["CSPO"]);
  });
  it("the preview text and the DOCX file contain exactly the same lines", async () => {
    for (const t of [tailored, masterAsTailored(profile)]) {
      const docx = (await mammoth.extractRawText({ buffer: await renderResumeDocx(profile, t, STYLES[0]) })).value;
      const docLines = docx.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const previewLines = resumeText(resumeView(profile, t, STYLES[0]), STYLES[0]).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
      expect(docLines.map((l) => l.replace(/\s+/g, " "))).toEqual(previewLines);
    }
  });
});

describe("snapshots", () => {
  it("copies only known job fields, with the fit result, and stamps the time", () => {
    const snap = buildJobSnapshot({ id: "j1", title: "PM", company: "X", description: "d", secret_internal: "no", salary_min: 1 }, { score: 82, model: "m", detail: { summary: "good", matchedSkills: ["SQL"], gaps: [] } }, new Date("2026-10-16T00:00:00Z"));
    expect(snap).toMatchObject({ id: "j1", title: "PM", company: "X", salary_min: 1, location: null, fit: { score: 82, summary: "good", matchedSkills: ["SQL"] }, captured_at: "2026-10-16T00:00:00.000Z" });
    expect(snap).not.toHaveProperty("secret_internal");
  });
  it("records no fit when the job was never scored", () => {
    expect(buildJobSnapshot({ id: "j" }, null).fit).toBeNull();
  });
  it("a profile snapshot is a deep copy: editing the profile afterwards does not change it", () => {
    const live = MasterProfile.parse(JSON.parse(JSON.stringify(profile)));
    const snap = buildProfileSnapshot(live);
    live.basics.name = "Someone Else";
    live.experience[0].bullets[0].text = "Rewritten";
    expect(snap.profile.basics.name).toBe("Asha Rao");
    expect(snap.profile.experience[0].bullets[0].text).toBe("Grew activation 24%");
  });
});
