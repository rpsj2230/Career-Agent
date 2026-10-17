import { describe, expect, it } from "vitest";
import { cleanQuestion, groupHandbacks, scopedQuestion, withAnswer } from "@/lib/apply/handbacks";

const app = (id: string, unanswered: string[], country: string | null = "in") => ({ id, title: "PM", company: `Co${id}`, country, unanswered });

describe("cleanQuestion", () => {
  it("removes form decorations", () => {
    expect(cleanQuestion("Expected CTC ✱")).toBe("Expected CTC");
    expect(cleanQuestion("  Notice  period * ")).toBe("Notice period");
    expect(cleanQuestion("Why do you want to join? (required)")).toBe("Why do you want to join?");
  });
  it("never offers consent boxes, uploads or technical errors for answering", () => {
    expect(cleanQuestion("I agree to the privacy policy (you must tick this yourself)")).toBeNull();
    expect(cleanQuestion("Expected CTC (locator.fill: Error: strict mode violation)")).toBeNull();
    expect(cleanQuestion("file upload")).toBeNull();
    expect(cleanQuestion("")).toBeNull();
    expect(cleanQuestion("x")).toBeNull();
  });
});

describe("groupHandbacks", () => {
  it("groups the same question across applications, most common first", () => {
    const g = groupHandbacks([app("1", ["Notice period ✱", "Favourite colour"]), app("2", ["notice period"]), app("3", ["Notice period", "Are you open to relocation?"], "sg")]);
    expect(g.map((x) => [x.question, x.count])).toEqual([["Notice period", 3], ["Are you open to relocation?", 1], ["Favourite colour", 1]]);
    expect(g[0].apps.map((a) => a.id)).toEqual(["1", "2", "3"]);
    expect(g[0].countries.sort()).toEqual(["in", "sg"]);
  });
  it("counts an application once per question, and skips things that are not questions", () => {
    const g = groupHandbacks([app("1", ["Notice period", "Notice period ✱", "I accept the terms (you must tick this yourself)"])]);
    expect(g).toHaveLength(1);
    expect(g[0].count).toBe(1);
  });
});

describe("saving an answer", () => {
  it("replaces an earlier entry for the same question and keeps the rest", () => {
    const out = withAnswer([{ question: "Notice period", answer: "30 days", source: "answer_bank" }, { question: "Expected CTC", answer: "30 LPA", source: "profile" }], "Notice Period ✱".replace(" ✱", ""), "15 days");
    expect(out).toEqual([{ question: "Expected CTC", answer: "30 LPA", source: "profile" }, { question: "Notice Period", answer: "15 days", source: "answer_bank" }]);
  });
  it("scopes an answer to a country by naming it, once", () => {
    expect(scopedQuestion("Are you authorised to work?", "India")).toBe("Are you authorised to work? (India)");
    expect(scopedQuestion("Are you authorised to work in India?", "India")).toBe("Are you authorised to work in India?");
    expect(scopedQuestion("Notice period", null)).toBe("Notice period");
  });
});
