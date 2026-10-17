import { describe, expect, it } from "vitest";
import { headlineProblems, unknownTerms, vocabulary } from "@/lib/docs/verify";
import { MasterProfile } from "@/lib/types";

const mk = (o: { title?: string; headline?: string; summary?: string; bullets?: string[]; skills?: string[]; degree?: string }) => MasterProfile.parse({
  basics: { name: "Asha Rao", headline: o.headline ?? "", summary: o.summary ?? "" },
  experience: [{ id: "e1", company: "Acme", title: o.title ?? "Engineer", bullets: (o.bullets ?? ["Shipped features"]).map((text, i) => ({ id: `e1.b${i}`, text })) }],
  education: o.degree ? [{ id: "ed1", school: "NUS", degree: o.degree }] : [],
  skills: (o.skills ?? []).map((name, i) => ({ id: `s${i}`, name })),
});
const head = (p: ReturnType<typeof mk>, h: string) => headlineProblems(h, vocabulary(p));
const terms = (p: ReturnType<typeof mk>, text: string) => unknownTerms(text, vocabulary(p));

describe("the abbreviation and the full title are the same fact", () => {
  it("profile says PM (with product context): 'Product Manager' is fine, 'Program Manager' is not", () => {
    const p = mk({ title: "PM", summary: "PM for a fintech product roadmap" });
    expect(head(p, "Product Manager")).toEqual([]);
    expect(head(p, "Program Manager")).toEqual(["Program"]);
  });
  it("profile says Product Manager: 'PM' is fine, 'TPM' and 'VP' are not", () => {
    const p = mk({ title: "Product Manager" });
    expect(head(p, "PM")).toEqual([]);
    expect(terms(p, "Worked as a PM on payments")).toEqual([]);
    expect(terms(p, "Worked as a TPM on payments")).toEqual(["TPM"]);
    expect(head(p, "VP Product")).toEqual(expect.arrayContaining(["VP"]));
  });
  it("a bare 'PM' with no context only unlocks what the profile can support (project, when the profile says project)", () => {
    const p = mk({ title: "PM", bullets: ["Delivered 12 project milestones"] });
    expect(head(p, "Project Manager")).toEqual([]);
    expect(head(p, "Product Manager")).toEqual(["Product"]);
  });
});

describe("other common abbreviations, both directions", () => {
  it("VP / Vice President", () => {
    expect(head(mk({ title: "VP Engineering" }), "Vice President Engineering")).toEqual([]);
    expect(head(mk({ title: "Vice President of Sales" }), "VP Sales")).toEqual([]);
  });
  it("Sr. and Senior only when the profile already says one of them", () => {
    expect(head(mk({ title: "Sr. Software Engineer" }), "Senior Software Engineer")).toEqual([]);
    expect(head(mk({ title: "Software Engineer" }), "Senior Software Engineer")).toEqual(["Senior"]);
  });
  it("degrees and fields", () => {
    expect(terms(mk({ degree: "Master of Business Administration" }), "Holds an MBA")).toEqual([]);
    expect(terms(mk({ degree: "MBA" }), "Holds a Master of Business Administration")).toEqual([]);
    expect(terms(mk({}), "Holds an MBA")).toEqual(["MBA"]);
  });
  it("metrics terms", () => {
    expect(terms(mk({ bullets: ["Raised Net Promoter Score by 12 points"] }), "Improved NPS by 12 points")).toEqual([]);
    expect(terms(mk({ bullets: ["Improved NPS by 12 points"] }), "Raised Net Promoter Score by 12 points")).toEqual([]);
    expect(terms(mk({ bullets: ["Improved NPS by 12 points"] }), "Raised CSAT by 12 points")).toEqual(["CSAT"]);
  });
});

describe("initialisms and written abbreviations are learned from the profile", () => {
  it("'Customer Success Manager (CSM)' works both ways, in any wording", () => {
    const p = mk({ title: "Customer Success Manager (CSM)" });
    expect(head(p, "CSM")).toEqual([]);
    expect(terms(p, "As a CSM I owned renewals")).toEqual([]);
  });
  it("initials of any capitalised phrase in the profile are accepted", () => {
    const p = mk({ bullets: ["Defined the Voice Of Customer program"] });
    expect(terms(p, "Led the VOC program")).toEqual([]);
  });
});

describe("it still catches real fabrication", () => {
  it("unrelated abbreviations, tools and employers are not waved through", () => {
    const p = mk({ title: "Product Manager" });
    expect(terms(p, "Certified CISSP and AWS")).toEqual(expect.arrayContaining(["CISSP", "AWS"]));
    expect(terms(p, "Previously at McKinsey")).toEqual(["McKinsey"]);
  });
  it("an abbreviation alone does not unlock unrelated expansions", () => {
    const p = mk({ title: "QA Lead" });
    expect(head(p, "Quality Assurance Lead")).toEqual([]);
    expect(head(p, "Business Analyst")).toEqual(expect.arrayContaining(["Business", "Analyst"]));
  });
});
