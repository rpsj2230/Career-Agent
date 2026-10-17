import { describe, expect, it } from "vitest";
import { buildAnswers } from "@/lib/apply/answers";
import { bankForJob, COUNTRY_SENSITIVE, generalPayAllowed, inferPayCountry, scopeCountry } from "@/lib/apply/country-scope";
import type { MasterProfile } from "@/lib/types";

const prefs = { countries: ["in", "sg"], roles: [], currentCtc: "24 LPA", expectedCtc: "32 LPA", noticePeriod: "60 days", visaStatus: "Indian citizen", relocate: true } as MasterProfile["preferences"];
const sg = [{ question: "Expected salary (SGD, per year)", answer: "SGD 120,000 per year", re: /expected.*(ctc|salary)/i }];
const find = <T extends { question: string }>(a: T[], re: RegExp) => a.find((x) => re.test(x.question));

describe("which country are the pay figures in", () => {
  it("reads it from how the pay is written", () => {
    expect(inferPayCountry({ currentCtc: "24 LPA" })).toBe("in");
    expect(inferPayCountry({ expectedCtc: "SGD 9,000 a month" })).toBe("sg");
    expect(inferPayCountry({ currentCtc: "£50k" })).toBe("gb");
    expect(inferPayCountry({ currentCtc: "negotiable" })).toBeUndefined();
  });
  it("an explicit country wins", () => expect(inferPayCountry({ payCountry: "AE", currentCtc: "24 LPA" })).toBe("ae"));
  it("allows general answers only where they were written, or when unknown", () => {
    expect(generalPayAllowed("in", "in")).toBe(true);
    expect(generalPayAllowed("sg", "in")).toBe(false);
    expect(generalPayAllowed(null, "in")).toBe(true);
    expect(generalPayAllowed("sg", undefined)).toBe(true);
  });
});

describe("buildAnswers for another country", () => {
  it("does not send the Indian CTC or visa answer to a Singapore form", () => {
    const a = buildAnswers([], prefs, undefined, [], "sg");
    expect(find(a, /current.*(ctc|salary)/i)).toBeUndefined();
    expect(find(a, /expected.*(ctc|salary)/i)).toBeUndefined();
    expect(find(a, /visa|authori/i)).toBeUndefined();
    expect(find(a, /notice/i)?.answer).toBe("60 days"); // not country specific
    expect(find(a, /relocat/i)?.answer).toBe("Yes");
  });
  it("uses the country's own expected salary instead", () => {
    const a = buildAnswers([], prefs, undefined, sg, "sg");
    expect(find(a, /expected/i)?.answer).toBe("SGD 120,000 per year");
    expect(find(a, /current.*(ctc|salary)/i)).toBeUndefined();
  });
  it("still answers fully for forms in the home country", () => {
    const a = buildAnswers([], prefs, undefined, [], "in");
    expect(find(a, /current.*(ctc|salary)/i)?.answer).toBe("24 LPA");
    expect(find(a, /visa/i)?.answer).toBe("Indian citizen");
  });
  it("behaves as before when the job's country is unknown", () => {
    expect(find(buildAnswers([], prefs, undefined, [], null), /expected.*ctc/i)?.answer).toBe("32 LPA");
  });
});

describe("answer bank scoping", () => {
  const bank = [
    { question: "What is your expected CTC?", answer: "32 LPA" },
    { question: "What is your expected CTC? (Singapore)", answer: "SGD 120,000" },
    { question: "Are you a citizen of India?", answer: "Yes" },
    { question: "Do you need visa sponsorship?", answer: "No" },
    { question: "How did you hear about us?", answer: "LinkedIn" },
  ];
  it("recognises scoped questions and sensitive ones", () => {
    expect(scopeCountry("What is your expected CTC? (Singapore)")).toBe("sg");
    expect(scopeCountry("What is your expected CTC?")).toBeNull();
    expect(scopeCountry("Notes (misc)")).toBeNull();
    expect(COUNTRY_SENSITIVE.test("Do you need visa sponsorship?")).toBe(true);
    expect(COUNTRY_SENSITIVE.test("How did you hear about us?")).toBe(false);
  });
  it("on a Singapore form keeps the Singapore pay answer and neutral answers, and drops the general pay and visa ones", () => {
    const q = bankForJob(bank, "sg", "in").map((b) => b.question);
    expect(q).toEqual(["What is your expected CTC? (Singapore)", "Are you a citizen of India?", "How did you hear about us?"]);
  });
  it("on an Indian form drops other countries' scoped answers", () => {
    const q = bankForJob(bank, "in", "in").map((b) => b.question);
    expect(q).toContain("What is your expected CTC?");
    expect(q).not.toContain("What is your expected CTC? (Singapore)");
  });
  it("a scoped answer replaces the general one even in the pay country", () => {
    const b = [{ question: "Expected CTC", answer: "32 LPA" }, { question: "Expected CTC (India)", answer: "34 LPA" }];
    expect(bankForJob(b, "in", "in").map((x) => x.answer)).toEqual(["34 LPA"]);
  });
});
