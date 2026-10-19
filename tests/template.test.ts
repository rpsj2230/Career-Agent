import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { renderResumeDocx } from "@/lib/tailor/docx";
import { masterAsTailored, resumeText, resumeView } from "@/lib/tailor/sections";
import { STYLES, styleById, styleFor, styleInstruction } from "@/lib/tailor/template";
import { MasterProfile } from "@/lib/types";

const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", email: "a@x.com", headline: "PM", summary: "Summary" },
  experience: [{ id: "e1", company: "Acme", title: "PM", start: "2020", end: "Present", bullets: ["a", "b", "c", "d", "e", "f"].map((t, i) => ({ id: `b${i}`, text: `Bullet ${t}` })) }],
  education: [{ id: "ed", degree: "MBA", school: "IIM" }],
  skills: [{ id: "s", name: "SQL" }],
});

describe("country styles", () => {
  it("picks a sensible default per region", () => {
    expect(styleFor("us").page).toBe("Letter");
    expect(styleFor("US").spelling).toBe("us");
    expect(styleFor("de").id).toBe("europe");
    expect(styleFor("ae").id).toBe("gulf");
    expect(styleFor("in").id).toBe("india");
    expect(styleFor("sg").id).toBe("standard");
    expect(styleFor(null).id).toBe("standard");
  });
  it("your override wins, and an unknown id falls back to standard", () => {
    expect(styleFor("de", { de: "us" }).id).toBe("us");
    expect(styleById("nonsense").id).toBe("standard");
  });
  it("tells the model which spelling to use", () => {
    expect(styleInstruction(styleById("us"))).toMatch(/American/);
    expect(styleInstruction(styleById("europe"))).toMatch(/British/);
  });
});

describe("template", () => {
  it("limits bullets per role to the style's maximum without touching the stored content", () => {
    const t = masterAsTailored(profile);
    expect(resumeView(profile, t, styleById("us")).experience[0].bullets).toHaveLength(4);
    expect(resumeView(profile, t, styleById("india")).experience[0].bullets).toHaveLength(6);
    expect(t.experience[0].bullets).toHaveLength(6);
  });
  it("uses the style's heading and section order in the DOCX and the preview text alike", async () => {
    for (const id of ["us", "europe"]) {
      const s = styleById(id), t = masterAsTailored(profile);
      const docx = (await mammoth.extractRawText({ buffer: await renderResumeDocx(profile, t, s) })).value.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
      expect(docx).toEqual(resumeText(resumeView(profile, t, s), s).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean));
    }
    const eu = resumeText(resumeView(profile, masterAsTailored(profile), styleById("europe")), styleById("europe"));
    expect(eu.indexOf("PROFILE")).toBeGreaterThan(-1);
    expect(eu.indexOf("EDUCATION")).toBeLessThan(eu.indexOf("SKILLS"));
  });
  it("sets the page size", async () => {
    const zip = async (id: string) => (await import("jszip")).default.loadAsync(await renderResumeDocx(profile, masterAsTailored(profile), styleById(id)));
    expect(await (await zip("us")).file("word/document.xml")!.async("string")).toMatch(/w:w="12240"/);
    expect(await (await zip("standard")).file("word/document.xml")!.async("string")).toMatch(/w:w="11906"/);
  });
  it("every style lists every section exactly once", () => {
    for (const s of STYLES) expect([...s.sections].sort()).toEqual(["awards", "caseStudies", "certifications", "competencies", "development", "education", "experience", "extras", "highlights", "skills", "summary", "technical"]);
  });
});
