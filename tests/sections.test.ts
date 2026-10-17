import { describe, expect, it } from "vitest";
import { parseProfileJson } from "@/lib/profile/json-import";
import { masterAsTailored, resumeText, resumeView } from "@/lib/tailor/sections";
import { renderResumeDocx, resumeParagraphs } from "@/lib/tailor/docx";
import { STYLES } from "@/lib/tailor/template";
import { verifyTailored } from "@/lib/docs/verify";
import { applyScope, DEFAULT_SCOPE } from "@/lib/tailor/scope";

const file = JSON.stringify({
  basics: { name: "Asha Rao", email: "a@x.com", phone: "1", location: "Singapore", headline: "Delivery Lead", summary: "Delivery leader.", links: [], credentials: "PMP | SFC", workStatus: "Employment Pass" },
  experience: [{ company: "Acme", title: "Lead", bullets: ["Ran 12 programmes"] }],
  education: [{ school: "S", degree: "MBA" }],
  skills: [
    { group: "Delivery", kind: "Core Competencies", items: ["Programme management", "Risk management"] },
    { group: "Tools", kind: "technical", items: ["Jira", "SQL"] },
    "Mentoring",
  ],
  certifications: ["PMP"],
  highlights: ["Delivered a $5M programme", "Cut cycle time 30%"],
  caseStudies: ["Migration case study"],
  development: ["Course X"],
  awards: ["Award Y"],
});

describe("resume sections follow the master resume", () => {
  const { profile } = parseProfileJson(file, { countries: [], roles: [] });
  const t = masterAsTailored(profile);

  it("imports each section separately with ids and skill headings", () => {
    expect(profile.highlights.map((h) => h.id)).toEqual(["hl1", "hl2"]);
    expect(profile.skills.map((s) => [s.name, s.group, s.kind])).toEqual([
      ["Programme management", "Delivery", "competency"], ["Risk management", "Delivery", "competency"], ["Jira", "Tools", "technical"], ["SQL", "Tools", "technical"], ["Mentoring", undefined, undefined],
    ]);
    expect(profile.basics.credentials).toBe("PMP | SFC");
  });

  it("lays the resume out in the section order with the right headings", () => {
    const text = resumeText(resumeView(profile, t, STYLES[0]), STYLES[0]);
    const heads = ["CAREER HIGHLIGHTS", "CASE STUDIES", "CORE COMPETENCIES", "TECHNICAL SKILLS", "SKILLS", "WORK EXPERIENCE", "CERTIFICATIONS", "PROFESSIONAL DEVELOPMENT", "EDUCATION", "AWARDS AND RECOGNITION"];
    const at = heads.map((h) => text.findIndex((l) => l === h));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).toContain("Delivery: Programme management, Risk management");
    expect(text).toContain("PMP | SFC");
    expect(text.find((l) => l.includes("Singapore"))).toContain("Employment Pass");
  });

  it("renders to DOCX", async () => {
    expect(resumeParagraphs(profile, t).length).toBeGreaterThan(15);
    expect((await renderResumeDocx(profile, t)).length).toBeGreaterThan(1000);
  });

  it("verifies highlight ids and shows only the chosen ones", () => {
    const picked = { ...t, highlightIds: ["hl2"] };
    expect(resumeView(profile, picked).highlights).toEqual(["Cut cycle time 30%"]);
    expect(verifyTailored(profile, picked).ok).toBe(true);
    expect(verifyTailored(profile, { ...t, highlightIds: ["nope"] }).ok).toBe(false);
  });

  it("a locked highlights switch restores the master selection", () => {
    const changed = { ...t, highlightIds: ["hl2"] };
    expect(applyScope(changed, profile, { ...DEFAULT_SCOPE, highlights: false }).highlightIds).toEqual(["hl1", "hl2"]);
  });
});
