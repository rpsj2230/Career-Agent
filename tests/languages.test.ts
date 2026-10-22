import { describe, expect, it } from "vitest";
import { canonicalLanguage, languageAnswer, languageAsked, parseLanguages } from "../src/lib/apply/languages";
import { matchAnswer } from "../worker/match";
import { skillYears, yearsSkill } from "../src/lib/apply/skill-years";
import { MasterProfile } from "../src/lib/types";

const MINE = "English: fluent (read, write, speak); Hindi: fluent (read, write, speak)";

describe("the languages you know", () => {
  it("reads the line, with commas inside brackets kept together", () => {
    expect([...parseLanguages(MINE)]).toEqual([["english", "fluent"], ["hindi", "fluent"]]);
    expect([...parseLanguages("English - native, Mandarin: conversational, French: basic, Tamil: none")]).toEqual([["english", "native"], ["chinese", "conversational"], ["french", "basic"], ["tamil", "none"]]);
    expect(parseLanguages("").size).toBe(0);
    expect(canonicalLanguage("Cantonese")).toBe("chinese");
  });
  it("tells a question about a language from other questions", () => {
    expect(languageAsked("What is your level of proficiency in Chinese?")).toBe("chinese");
    expect(languageAsked("Do you speak Hindi?")).toBe("hindi");
    expect(languageAsked("Spoken English")).toBe("english");
    expect(languageAsked("Why do you want this role?")).toBeNull();
    expect(languageAsked("How many years with English literature tutoring?")).toBeNull(); // a years question about a field, not about knowing the language
  });
});

describe("answering a language question from your languages", () => {
  const Q = (l: string) => `What is your level of proficiency in ${l}?`;
  it("answers a listed language with its level, and any other language as none", () => {
    expect(languageAnswer(Q("English"), [], MINE)).toBe("Fluent (read, write and speak)");
    expect(languageAnswer(Q("Hindi"), [], MINE)).toBe("Fluent (read, write and speak)");
    expect(languageAnswer(Q("Chinese"), [], MINE)).toBe("None (no working knowledge)");
    expect(languageAnswer(Q("Japanese"), [], MINE)).toBe("None (no working knowledge)");
  });
  it("chooses the right option from a list", () => {
    const li = ["Elementary proficiency", "Limited working proficiency", "Professional working proficiency", "Full professional proficiency", "Native or bilingual proficiency"];
    expect(languageAnswer(Q("English"), li, MINE)).toBe("Full professional proficiency");
    expect(languageAnswer(Q("English"), li, "English: native")).toBe("Native or bilingual proficiency");
    expect(languageAnswer(Q("Chinese"), li, MINE)).toBeNull(); // no option says "none": it goes to you, never to "elementary"
    const plain = ["None", "Basic", "Conversational", "Fluent", "Native"];
    expect(languageAnswer(Q("English"), plain, MINE)).toBe("Fluent");
    expect(languageAnswer(Q("Chinese"), plain, MINE)).toBe("None");
  });
  it("answers yes or no questions", () => {
    expect(languageAnswer("Do you speak Hindi?", ["Yes", "No"], MINE)).toBe("Yes");
    expect(languageAnswer("Are you fluent in Mandarin?", ["Yes", "No"], MINE)).toBe("No");
    expect(languageAnswer("Do you speak Chinese?", [], MINE)).toBe("No");
  });
  it("answers nothing until you have listed your languages, and nothing for other questions", () => {
    expect(languageAnswer(Q("Chinese"), [], "")).toBeNull();
    expect(languageAnswer(Q("Chinese"), [], undefined)).toBeNull();
    expect(languageAnswer("Why do you want this role?", [], MINE)).toBeNull();
  });
  it("is never answered from a saved answer about another language", () => {
    const bank = [{ question: "What is your level of proficiency in English?", answer: "Fluent" }];
    expect(matchAnswer(Q("Chinese"), bank)).toBeNull();
    expect(matchAnswer(Q("English"), bank)).toBe("Fluent");
  });
});

describe("years across several fields in one question", () => {
  const p = MasterProfile.parse({ basics: { name: "A" }, experience: [
    { id: "e1", company: "Verz", title: "Director", start: "2017", end: "Present", bullets: [{ id: "b1", text: "Ran change-management programmes and trained 200 managers" }] },
    { id: "e2", company: "Acme", title: "Programme Manager", start: "2012", end: "2017", bullets: [{ id: "b2", text: "Delivered workshops for four regions" }] },
    { id: "e3", company: "Old", title: "Analyst", start: "2008", end: "2012", bullets: [{ id: "b3", text: "Built dashboards" }] },
  ] });
  it("counts from the first to the last role that mentions any of them", () => {
    const q = "How many years of experience do you have in designing and delivering training, workshops, and change management initiatives?";
    expect(skillYears(p, yearsSkill(q)!, 2026)).toBe("14"); // 2012 (workshops) to 2026 (training, change management)
  });
  it("still answers a single tool, and a short word only as a whole word", () => {
    expect(skillYears(p, "dashboards", 2026)).toBe("4");
    expect(skillYears(p, "ai", 2026)).toBeNull();
  });
});
