import { describe, expect, it } from "vitest";
import { matchAnswer, meaning } from "../worker/match";

describe("a rephrased question finds the answer saved for another wording", () => {
  const bank = [
    { question: "Are you comfortable working on-site at the office?", answer: "Yes" },
    { question: "Do you have a bachelor's degree?", answer: "Yes" },
    { question: "When can you start?", answer: "Immediately" },
    { question: "Are you willing to relocate?", answer: "Yes" },
  ];
  it("folds the many ways of saying the same thing", () => {
    expect([...meaning("Are you legally entitled to work in Singapore?")].sort()).toEqual([...meaning("Do you have the right to work in Singapore?")].sort());
    expect(meaning("What is your expected salary?")).toEqual(meaning("Desired compensation expectation"));
  });
  it("answers the same question asked another way", () => {
    expect(matchAnswer("Are you okay with working from the office on-site?", bank)).toBe("Yes");
    expect(matchAnswer("What is your earliest availability to start?", bank)).toBe("Immediately");
    expect(matchAnswer("Would you be open to relocation?", bank)).toBe("Yes");
  });
  it("ignores the instructions a question carries", () => {
    expect(matchAnswer("Which languages do you speak? Select all that apply.", [{ question: "Which of these languages do you speak?", answer: "English; Hindi" }])).toBe("English; Hindi");
  });
  it("does not borrow an answer for a different question that shares a few words", () => {
    expect(matchAnswer("Do you have experience managing a team of 50 people?", bank)).toBeNull();
    expect(matchAnswer("Are you comfortable with a background check?", bank)).toBeNull();
    expect(matchAnswer("What is your highest degree?", bank)).toBeNull();
  });
  it("never lets a rephrasing cross the pay, visa and sponsorship questions", () => {
    const visa = [{ question: "Are you legally authorised to work in Singapore?", answer: "Yes" }];
    expect(matchAnswer("Will you now or in the future require sponsorship?", visa)).toBeNull();
    expect(matchAnswer("Do you have the right to work in Singapore?", visa)).toBe("Yes");
  });
});
