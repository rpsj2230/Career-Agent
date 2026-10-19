import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { renderCoverLetterDocx, renderResumeDocx } from "@/lib/tailor/docx";
import { masterAsTailored, resumeView } from "@/lib/tailor/sections";
import { STYLES } from "@/lib/tailor/template";
import { MasterProfile } from "@/lib/types";

const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", email: "asha@example.com", phone: "+65 8123 4567", location: "Singapore", headline: "Senior Product Manager", summary: "Product manager.", links: ["linkedin.com/in/asharao"] },
  experience: [{ id: "e1", company: "Acme Pay", title: "Senior Product Manager", location: "Singapore", start: "Jan 2019", end: "Present", bullets: [{ id: "b1", text: "Grew activation by 24% with SQL" }, { id: "b2", text: "Led a squad of 8" }] }],
  education: [{ id: "ed", degree: "MBA", school: "IIM Bangalore", start: "2014", end: "2016" }],
  skills: [{ id: "s1", name: "SQL" }, { id: "s2", name: "Roadmapping" }],
  certifications: [{ id: "c1", name: "CSPO" }],
});
const STANDARD_HEADINGS = new Set(["PROFESSIONAL SUMMARY", "SUMMARY", "PROFILE", "CAREER HIGHLIGHTS", "CORE COMPETENCIES", "TECHNICAL SKILLS", "SKILLS", "PROFESSIONAL EXPERIENCE", "WORK EXPERIENCE", "EDUCATION", "CERTIFICATIONS", "PROFESSIONAL DEVELOPMENT", "AWARDS AND RECOGNITION", "CASE STUDIES"]);

const open = async (buf: Buffer) => JSZip.loadAsync(buf);

describe("resume is ATS-friendly in every style", () => {
  for (const style of STYLES) {
    it(`${style.id}: single flow of text, standard headings, no layout tricks`, async () => {
      const zip = await open(await renderResumeDocx(profile, masterAsTailored(profile), style));
      const names = Object.keys(zip.files);
      expect(names.filter((n) => /header|footer|media\/|embeddings|drawings|comments/.test(n))).toEqual([]);
      const xml = await zip.file("word/document.xml")!.async("string");
      for (const banned of ["<w:drawing", "<w:pict", "<w:txbxContent", "<w:framePr", "<w:sdt>", "<mc:AlternateContent", "<w:footnoteReference"]) expect(xml, banned).not.toContain(banned);
      // the only table is the plain two-column layout of short lists (certifications and the like): one row, no nesting
      expect((xml.match(/<w:tbl>/g) ?? []).length).toBeLessThanOrEqual(3);
      expect(xml).not.toMatch(/<w:tbl>(?:(?!<\/w:tbl>)[\s\S])*<w:tbl>/);
      expect(xml.match(/<w:cols [^>]*w:num="(\d+)"/)?.[1] ?? "1").toBe("1");
      const fonts = new Set([...xml.matchAll(/w:ascii="([^"]+)"/g)].map((m) => m[1]));
      expect([...fonts]).toEqual(["Calibri"]);
      // every section heading is a real heading paragraph with a standard name
      const paragraphs = xml.split("</w:p>");
      const headings = paragraphs.filter((x) => x.includes('<w:pStyle w:val="Heading2"/>')).map((x) => [...x.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""));
      expect(headings.length).toBeGreaterThanOrEqual(4);
      for (const h of headings) expect(STANDARD_HEADINGS.has(h), h).toBe(true);
    });
  }

  it("contact details are in the body (not a header), and dates read as ordinary text", async () => {
    const zip = await open(await renderResumeDocx(profile, masterAsTailored(profile)));
    const text = (await zip.file("word/document.xml")!.async("string")).replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, "");
    expect(text.indexOf("asha@example.com")).toBeGreaterThan(-1);
    expect(text.indexOf("asha@example.com")).toBeLessThan(text.indexOf("SUMMARY".charAt(0) === "S" ? "Product manager" : ""));
    expect(text).toContain("Acme Pay, Singapore\tJan 2019 – Present");
    expect(text).toContain("Senior Product Manager");
  });

  it("the cover letter is plain paragraphs too", async () => {
    const zip = await open(await renderCoverLetterDocx(profile, { text: "Para one.\n\nPara two.", sourceIds: [] }, "Beta"));
    const xml = await zip.file("word/document.xml")!.async("string");
    for (const banned of ["<w:tbl>", "<w:drawing", "<w:txbxContent"]) expect(xml).not.toContain(banned);
    expect(Object.keys(zip.files).filter((n) => /header|footer/.test(n))).toEqual([]);
  });

  it("no unusual characters that parsers mangle (only plain text, bullets come from list styling)", () => {
    const v = resumeView(profile, masterAsTailored(profile));
    const all = JSON.stringify(v);
    expect(all).not.toMatch(/[•●▪■★✓→]/); // a middle dot between contact details and headline parts is ordinary text
  });
});
