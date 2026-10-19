import { describe, expect, it } from "vitest";
import { addFacts, addSkills, looksGrouped, parseFacts, parseSkillLines, splitTop } from "@/lib/profile/bulk";
import { duplicateId } from "@/lib/profile/skills";
import { MasterProfile } from "@/lib/types";

const base = (): MasterProfile => MasterProfile.parse({
  basics: {}, preferences: { countries: [], roles: [] },
  experience: [{ id: "exp1", company: "Verz", title: "Operations Manager", bullets: [{ id: "exp1-b1", text: "Existing fact." }] }],
  skills: [{ id: "skill1", name: "Scrum", kind: "competency" }],
});

describe("pasted skill lists", () => {
  it("reads a numbered list, one skill per line", () => {
    expect(parseSkillLines("1. Artificial Intelligence (AI)\n2. Generative AI\n 3) Digital Transformation\n• Change Management\n\n- PMO")).toEqual([
      { name: "Artificial Intelligence (AI)" }, { name: "Generative AI" }, { name: "Digital Transformation" }, { name: "Change Management" }, { name: "PMO" },
    ]);
  });
  it("keeps commas inside brackets together", () => {
    expect(splitTop("SEO (on-page, technical), GEO; Shopify")).toEqual(["SEO (on-page, technical)", "GEO", "Shopify"]);
  });
  it("reads 'Heading: item, item' lines, joining a line that wrapped", () => {
    const text = "• AI Agents & Workflow Automation: agent design, task decomposition,\nhuman-in-the-loop approvals\n• LLM, RAG & Context: Claude, Kimi, Gemini and Groq models, tool use and MCP, retrieval-augmented\ngeneration (RAG), knowledge bases\n• Web, eCommerce & Data: WordPress, WooCommerce, PHP";
    expect(looksGrouped(text)).toBe(true);
    const r = parseSkillLines(text);
    expect(r.filter((x) => x.group === "AI Agents & Workflow Automation").map((x) => x.name)).toEqual(["agent design", "task decomposition", "human-in-the-loop approvals"]);
    expect(r.filter((x) => x.group === "LLM, RAG & Context").map((x) => x.name)).toEqual(["Claude", "Kimi", "Gemini and Groq models", "tool use and MCP", "retrieval-augmented generation (RAG)", "knowledge bases"]);
    expect(r.filter((x) => x.group === "Web, eCommerce & Data").length).toBe(3);
  });
  it("does not mistake a plain list for headings", () => expect(looksGrouped("Generative AI\nChange Management\nPMO")).toBe(false));
});

describe("adding skills", () => {
  it("adds new ones in the chosen section, skipping repeats and anything already there", () => {
    const r = addSkills(base().skills, parseSkillLines("scrum\nGenerative AI\nGenerative AI\nPMO"), { section: "competency" });
    expect(r.added).toEqual(["Generative AI", "PMO"]);
    expect(r.skipped).toEqual(["scrum", "Generative AI"]);
    expect(r.skills.map((s) => s.name)).toEqual(["Scrum", "Generative AI", "PMO"]);
    expect(r.skills.every((s) => s.kind === "competency")).toBe(true);
    expect(new Set(r.skills.map((s) => s.id)).size).toBe(3);
  });
  it("can put them first, in the order pasted (the top five lead the section)", () => {
    const r = addSkills(base().skills, parseSkillLines("Artificial Intelligence (AI)\nGenerative AI"), { section: "competency", first: true });
    expect(r.skills.map((s) => s.name)).toEqual(["Artificial Intelligence (AI)", "Generative AI", "Scrum"]);
  });
  it("uses the pasted heading, else the chosen one, and the technical section", () => {
    const r = addSkills([], parseSkillLines("Platforms: Shopify, Magento\n• PostgreSQL", true), { section: "technical", group: "Other tools" });
    expect(r.skills.map((s) => [s.name, s.group, s.kind])).toEqual([["Shopify", "Platforms", "technical"], ["Magento", "Platforms", "technical"], ["PostgreSQL", "Other tools", "technical"]]);
  });
  it("leaves 'other' skills without a section and can mark them search-only", () => {
    const r = addSkills([], [{ name: "X" }], { section: "other", extra: true });
    expect(r.skills[0]).toEqual({ id: "skill1", name: "X", extra: true });
  });
});

describe("experience facts", () => {
  const pasted = "Built and scaled the maintenance and renewals function and led delivery operations through the COVID eCommerce shift.\n\n• Identified recurring revenue as an untapped growth channel and built the function from zero: designed the\nsupport and renewals operating model, hired and trained an 11-person team.\n• Re-skilled operations teams across WooCommerce, Magento and Shopify.\n• Led UX and SEO teams directly.";
  it("makes the description one fact and each bullet another, joining wrapped lines", () => {
    const f = parseFacts(pasted);
    expect(f.length).toBe(4);
    expect(f[0]).toMatch(/^Built and scaled/);
    expect(f[1]).toBe("Identified recurring revenue as an untapped growth channel and built the function from zero: designed the support and renewals operating model, hired and trained an 11-person team.");
  });
  it("adds them to the chosen role with unique ids, skipping repeats", () => {
    const p = base();
    const r = addFacts(p, "exp1", [...parseFacts(pasted), "existing fact."], true);
    expect(r.added).toBe(4); expect(r.skipped).toBe(1);
    const e = r.experience[0];
    expect(e.bullets.map((b) => b.text)[0]).toMatch(/^Built and scaled/);
    expect(e.bullets.at(-1)?.text).toBe("Existing fact.");
    expect(duplicateId({ ...p, experience: r.experience })).toBeNull();
  });
  it("never reuses an id that exists anywhere in the profile", () => {
    const p = base();
    p.highlights = [{ id: "exp1-f2", text: "h" }];
    const r = addFacts(p, "exp1", ["a", "b"]);
    expect(duplicateId({ ...p, experience: r.experience })).toBeNull();
  });
  it("leaves other roles alone", () => {
    const p = base(); p.experience.push({ id: "exp2", company: "B", title: "T", bullets: [] });
    expect(addFacts(p, "exp1", ["z"]).experience[1].bullets).toEqual([]);
  });
});

import { caseStudiesToText, draftsToSections, parseCaseStudies, parseMetrics, parseSectionBullets, sectionToDraft } from "@/lib/profile/bulk";

describe("header strip, extra sections and case studies", () => {
  it("reads key figures one per line or with bars", () => {
    expect(parseMetrics("150+ People Led | 4 Countries\n\n  S$4M+ Portfolio ")).toEqual(["150+ People Led", "4 Countries", "S$4M+ Portfolio"]);
  });
  it("reads 'Label: text' bullets and joins wrapped lines", () => {
    expect(parseSectionBullets("• MIRA, the Maintenance Agent: supports the team,\nhandles tickets\n• Plain bullet")).toEqual([{ label: "MIRA, the Maintenance Agent", text: "supports the team, handles tickets" }, { text: "Plain bullet" }]);
  });
  it("round-trips a section and gives new ones unique ids that never clash", () => {
    const p = base();
    p.sections = [{ id: "sec1", title: "Key AI Agents", bullets: [{ id: "sec1.b1", label: "MIRA", text: "does things" }] }];
    const d = p.sections.map(sectionToDraft);
    expect(d[0].bulletsText).toBe("MIRA: does things");
    const out = draftsToSections(p, [...d, { title: "Company Brain", intro: " A paragraph ", flow: "A › B", bulletsText: "One: two\nThree" }, { title: "  ", intro: "", flow: "", bulletsText: "x" }]);
    expect(out.map((x) => x.id)).toEqual(["sec1", "sec2"]);
    expect(out[1]).toEqual({ id: "sec2", title: "Company Brain", intro: "A paragraph", flow: "A › B", bullets: [{ id: "sec2.b1", label: "One", text: "two" }, { id: "sec2.b2", text: "Three" }] });
    expect(duplicateId({ ...p, sections: out })).toBeNull();
  });
  it("keeps case study ids and links, adds new ones, ignores repeats and bad links", () => {
    const p = base();
    p.caseStudies = [{ id: "cs1", title: "Old study", url: "https://a.example" }];
    const out = parseCaseStudies(p, "Old study | https://a.example\nNew study | not-a-link\nnew study\nThird | https://b.example/x?y=1|2");
    expect(out).toEqual([{ id: "cs1", title: "Old study", url: "https://a.example" }, { id: "cs2", title: "New study" }, { id: "cs3", title: "Third", url: "https://b.example/x?y=1|2" }]);
    expect(caseStudiesToText(out)).toBe("Old study | https://a.example\nNew study\nThird | https://b.example/x?y=1|2");
  });
});
