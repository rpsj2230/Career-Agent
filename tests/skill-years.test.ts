import { describe, expect, it } from "vitest";
import { asCount, skillYears, wantsNumber, yearsSkill } from "../src/lib/apply/skill-years";
import { matchAnswer } from "../worker/match";
import { clean } from "../worker/form";
import { MasterProfile } from "../src/lib/types";

const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", email: "a@x.com", location: "Singapore", links: [] },
  experience: [
    { id: "e1", company: "Verz", title: "Operations Director", start: "2017", end: "Present", bullets: [{ id: "e1.b1", text: "Moved the delivery platform to Azure and led a 150-person team" }, { id: "e1.b2", text: "Ran Jira and Kubernetes rollouts" }] },
    { id: "e2", company: "Acme", title: "Programme Manager", start: "2012", end: "2017", bullets: [{ id: "e2.b1", text: "Delivered Azure DevOps pipelines for 4 countries" }] },
  ],
  skills: [{ id: "s1", name: "Terraform" }, { id: "s2", name: "Programme management" }],
});

describe("which tool a years-of-experience question is about", () => {
  it("reads the tool from the common wordings, so one answer serves them all", () => {
    expect(yearsSkill("How many years of work experience do you have with Microsoft Azure?")).toBe("azure");
    expect(yearsSkill("Years of experience with Azure")).toBe("azure");
    expect(yearsSkill("How many years of experience do you have using Kubernetes? *")).toBe("kubernetes");
    expect(yearsSkill("How many years of professional experience do you have in Amazon Web Services?")).toBe("aws");
    expect(yearsSkill("Python experience (in years)")).toBe("python");
  });
  it("is not fooled by questions that are not about one tool", () => {
    expect(yearsSkill("Why do you want this role?")).toBeNull();
    expect(yearsSkill("Are you authorised to work in Singapore?")).toBeNull();
    expect(yearsSkill("Email address")).toBeNull();
  });
  it("tells which questions want a number, and keeps only the number", () => {
    expect(wantsNumber("How many years of work experience do you have with Microsoft Azure?")).toBe(true);
    expect(wantsNumber("How many direct reports do you manage?")).toBe(true);
    expect(wantsNumber("Describe your experience")).toBe(false);
    expect(asCount("about 12 years")).toBe("12");
    expect(asCount("Yes")).toBe("Yes");
  });
});

describe("years the profile itself shows", () => {
  it("counts from the first to the last role that names the tool", () => {
    expect(skillYears(profile, "azure", 2026)).toBe("14"); // 2012 (Acme) to 2026 (Verz, present)
    expect(skillYears(profile, "kubernetes", 2026)).toBe("9"); // only the 2017 role
  });
  it("gives no number for a tool the profile does not show work with (a skills-list entry is not years of use)", () => {
    expect(skillYears(profile, "terraform", 2026)).toBeNull();
    expect(skillYears(profile, "salesforce", 2026)).toBeNull();
  });
  it("does not match inside another word", () => {
    expect(skillYears(profile, "java", 2026)).toBeNull();
  });
});

describe("a saved answer is reused for the same tool and never for another", () => {
  const bank = [{ question: "Years of experience with Azure", answer: "6 years" }, { question: "How many years of experience do you have with Kubernetes?", answer: "3" }];
  it("matches across wordings", () => {
    expect(matchAnswer("How many years of work experience do you have with Microsoft Azure?", bank)).toBe("6 years");
    expect(matchAnswer("How many years of experience do you have with Kubernetes?", bank)).toBe("3");
  });
  it("answers nothing for a tool that has no saved answer, even though the wording is close", () => {
    expect(matchAnswer("How many years of experience do you have with Terraform?", bank)).toBeNull();
  });
});

describe("labels that arrive twice", () => {
  it("collapses a label a site repeats for screen readers", () => {
    const q = "How many years of work experience do you have with Microsoft Azure?";
    expect(clean(`${q}*${q}`)).toBe(q);
    expect(clean(`${q} ${q}`)).toBe(q);
    expect(clean("Email address*")).toBe("Email address");
  });
});

import { newQuestions } from "../worker/ai-answers-core";
import { describeError } from "../src/lib/llm/fallback";
import { parkMillis } from "../src/lib/llm/spread";
describe("a long years question, and failing models", () => {
  it("reads the field in a long 'years in designing and delivering ...' question, so the default rule answers it", () => {
    const q = "How many years of experience do you have in designing and delivering training, workshops, and change management initiatives?";
    expect(yearsSkill(q)).toBe("designing and delivering training workshops and change management initiatives");
  });
  it("puts a question to a model once per application, not on every page", () => {
    const asked = new Set<string>();
    const a = { label: "Why this role?", type: "textarea" as const, options: [], required: true };
    const b = { label: "Notice period", type: "text" as const, options: [], required: true };
    expect(newQuestions([a], asked)).toEqual([a]);
    expect(newQuestions([a, b], asked)).toEqual([b]);
    expect(newQuestions([a, b], asked)).toEqual([]);
  });
  it("says what failed when a provider gives an empty message", () => {
    expect(describeError(new Error("Rate limit reached"))).toBe("Rate limit reached");
    const e = Object.assign(new Error(""), { name: "APICallError", statusCode: 401, responseBody: '{"error":"invalid api key"}' });
    expect(describeError(e)).toMatch(/APICallError HTTP 401/);
    expect(describeError(e)).toMatch(/invalid api key/);
    expect(describeError(new Error(""))).toMatch(/no message/);
  });
  it("parks a model the account cannot use for hours, and a rate-limited one for minutes", () => {
    expect(parkMillis("The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.")).toBe(6 * 3_600_000);
    expect(parkMillis("Rate limit reached for model on tokens per day")).toBe(5 * 60_000);
    expect(parkMillis("No object generated: response did not match schema")).toBe(60_000);
  });
});
