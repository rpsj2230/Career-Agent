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
