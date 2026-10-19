import JSZip from "jszip";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { renderResumeDocx } from "@/lib/tailor/docx";
import { groupEmployers, masterAsTailored, resumeText, resumeView } from "@/lib/tailor/sections";
import { STYLES } from "@/lib/tailor/template";
import { factIndex } from "@/lib/docs/verify";
import { factsBlock } from "@/lib/tailor/tailor";
import { MasterProfile } from "@/lib/types";

const profile = MasterProfile.parse({
  basics: { name: "Rupash Pratap Singh", email: "r@example.com", phone: "+65 1", location: "Singapore", workStatus: "Employment Pass (EP)", links: ["linkedin.com/in/r"], headline: "AI Transformation Leader · Operations Director", credentials: "PMP® · SFC™", metrics: ["150+ People Led", "4 Countries"], summary: "Summary text." },
  experience: [
    { id: "e1", company: "Verz Design", title: "Operations Director", location: "Singapore", start: "Jul 2020", end: "Present", bullets: [{ id: "e1.b1", text: "Led AI adoption." }] },
    { id: "e2", company: "Verz Design", title: "Project Manager", location: "Singapore", start: "Mar 2017", end: "Sep 2019", bullets: [{ id: "e2.b1", text: "Delivered builds." }] },
    { id: "e3", company: "Enggsol", title: "Technical Project Manager", location: "Singapore", start: "Dec 2015", end: "Feb 2017", bullets: [{ id: "e3.b1", text: "Owned documentation." }] },
  ],
  education: [{ id: "ed1", degree: "MBA", school: "A University", start: "2013", end: "2015" }],
  certifications: [{ id: "c1", name: "PMP®" }, { id: "c2", name: "SFC™" }, { id: "c3", name: "PMEC™" }],
  awards: [{ id: "a1", name: "Employee of the Year, Verz Design, 2019" }],
  caseStudies: [{ id: "cs1", title: "Cutting Delivery Cycles", url: "https://example.com/case" }, { id: "cs2", title: "Recurring Revenue" }],
  sections: [{ id: "sec1", title: "Key AI Agents", intro: "Intro paragraph.", flow: "A › B › C", bullets: [{ id: "sec1.b1", label: "MIRA", text: "handles tickets." }, { id: "sec1.b2", text: "Plain bullet." }] }],
});
const t = masterAsTailored(profile);

describe("the resume template", () => {
  const v = resumeView(profile, t, STYLES[0]);

  it("prints roles at one employer under a single employer line with the whole stay", () => {
    expect(v.experience.map((e) => [e.title, e.dates, e.employer?.name, e.employer?.dates])).toEqual([
      ["Operations Director", "Jul 2020 – Present", "Verz Design", "Mar 2017 – Present"],
      ["Project Manager", "Mar 2017 – Sep 2019", undefined, undefined],
      ["Technical Project Manager", "", "Enggsol", "Dec 2015 – Feb 2017"], // a single role: its dates sit on the employer line
    ]);
  });

  it("groups only neighbouring roles of the same employer (any capitals)", () => {
    const base = { title: "T", dates: "", location: null, bullets: [] };
    const g = groupEmployers([{ ...base, company: "A", start: "2020", end: "2021" }, { ...base, company: "B", start: "2018", end: "2019" }, { ...base, company: "a", start: "2016", end: "2017" }]);
    expect(g.filter((e) => e.employer).length).toBe(3);
  });

  it("carries the key figures, extra sections and case study links as written", () => {
    expect(v.metrics).toEqual(["150+ People Led", "4 Countries"]);
    expect(v.extras).toEqual([{ title: "Key AI Agents", intro: "Intro paragraph.", flow: "A › B › C", bullets: [{ label: "MIRA", text: "handles tickets." }, { label: "", text: "Plain bullet." }] }]);
    expect(v.caseStudies).toEqual([{ title: "Cutting Delivery Cycles", url: "https://example.com/case" }, { title: "Recurring Revenue", url: null }]);
    expect(v.contact).toBe("Singapore, Employment Pass (EP) · +65 1 · r@example.com · linkedin.com/in/r");
  });

  it("puts the extra sections after Career Highlights and before Case Studies, in every style that has them", () => {
    const text = resumeText(v, STYLES[0]);
    expect(text.indexOf("KEY AI AGENTS")).toBeGreaterThan(text.indexOf("PROFESSIONAL SUMMARY"));
    expect(text.indexOf("KEY AI AGENTS")).toBeLessThan(text.indexOf("CASE STUDIES"));
    expect(text.indexOf("PROFESSIONAL EXPERIENCE")).toBeLessThan(text.indexOf("CERTIFICATIONS"));
  });

  it("renders to a DOCX with a real heading for each section, two-column lists, a link and the same lines as the preview", async () => {
    const buf = await renderResumeDocx(profile, t, STYLES[0]);
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    const heads = xml.split("</w:p>").filter((x) => x.includes('<w:pStyle w:val="Heading2"/>')).map((x) => [...x.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
    expect(heads).toContain("KEY AI AGENTS");
    expect(heads).toContain("PROFESSIONAL EXPERIENCE");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("<w:hyperlink");
    expect(xml).toContain("<w:caps/>"); // names print in capitals without changing the text a parser reads
    const lines = (await mammoth.extractRawText({ buffer: buf })).value.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    expect(lines).toEqual(resumeText(v, STYLES[0]).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean));
  });
});

describe("the key figures and extra sections are the candidate's own facts", () => {
  it("can be cited by the tailoring step and its checker", () => {
    expect(factIndex(profile).get("metric1")).toBe("150+ People Led");
    expect(factIndex(profile).get("sec1.b1")).toBe("MIRA handles tickets.");
    expect(factIndex(profile).get("sec1.intro")).toBe("Intro paragraph.");
    const block = factsBlock(profile);
    expect(block).toContain("[metric1] 150+ People Led");
    expect(block).toContain("[sec1.b1] MIRA: handles tickets.");
  });
});
