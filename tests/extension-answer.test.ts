import { beforeEach, describe, expect, it, vi } from "vitest";

const world = {
  bank: [] as { question: string; answer: string }[], tried: {} as Record<string, string>, saved: [] as { question: string; answer: string; by: string }[],
  reply: "Yes" as string | Error, prompts: [] as string[], profileEmpty: false,
};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => ({ from: () => ({ select: () => ({ limit: async () => ({ data: world.bank, error: null }) }) }) }), must: (r: { data: unknown }) => r.data }));
vi.mock("@/lib/settings", () => ({ getSetting: async () => world.tried, putSetting: async (_k: string, v: Record<string, string>) => { world.tried = v; } }));
vi.mock("@/lib/profile/store", () => ({ getProfile: async () => ({ experience: world.profileEmpty ? [] : [{ id: "e1", company: "Verz", title: "Operations Director", start: "2012", end: "Present", bullets: [{ id: "b", text: "Ran training workshops" }] }], basics: { name: "Asha Rao" }, preferences: {}, skills: [], education: [] }) }));
vi.mock("@/lib/autofill/written-answers", async (orig) => ({ ...(await orig<typeof import("@/lib/autofill/written-answers")>()), richFacts: () => "Operations Director at Verz since 2012. English: fluent. Based in Singapore." }));
vi.mock("@/lib/llm/registry", () => ({ runText: async (o: { prompt: string }) => { world.prompts.push(o.prompt); if (world.reply instanceof Error) throw world.reply; return { text: world.reply }; } }));
vi.mock("@/lib/apply/save-answer", () => ({ saveAnswerAndRequeue: async (o: { question: string; answer: string; by: string }) => { world.saved.push({ question: o.question, answer: o.answer, by: o.by }); return { requeued: 0 }; } }));

import { answerForExtension, chooseOption } from "@/lib/extension/answer";

describe("chooseOption", () => {
  it("maps a free answer to the option it means", () => {
    expect(chooseOption(["Yes", "No"], "Yes, I do")).toBe("Yes");
    expect(chooseOption(["Yes", "No"], "no")).toBe("No");
    expect(chooseOption(["Less than 1 year", "1-3 years", "5+ years"], "5+ years")).toBe("5+ years");
    expect(chooseOption(["Singapore (+65)", "India (+91)"], "+65")).toBe("Singapore (+65)");
    expect(chooseOption(["Yes", "No"], "Maybe later")).toBeNull();
  });
});

describe("answering what the extension could not", () => {
  beforeEach(() => { world.bank = []; world.tried = {}; world.saved = []; world.reply = "Yes"; world.prompts = []; world.profileEmpty = false; });

  it("answers a rephrased question from the saved answers, without asking a model or saving anything", async () => {
    world.bank = [{ question: "Are you willing to relocate?", answer: "Yes" }];
    const r = await answerForExtension([{ question: "Would you be open to relocation?", options: ["Yes", "No"], kind: "radio" }]);
    expect(r).toEqual([{ question: "Would you be open to relocation?", answer: "Yes", why: "from your saved answers", source: "saved" }]);
    expect(world.prompts).toEqual([]);
    expect(world.saved).toEqual([]);
  });
  it("asks the AI for a question the saved answers do not cover, gives it the options, and saves the answer to the bank", async () => {
    world.reply = "Yes, fluent";
    const r = await answerForExtension([{ question: "Are you fluent in English?", options: ["Yes", "No"], kind: "radio" }]);
    expect(r[0]).toMatchObject({ answer: "Yes", source: "ai" });
    expect(world.prompts[0]).toContain("OPTIONS: Yes | No");
    expect(world.saved).toEqual([{ question: "Are you fluent in English?", answer: "Yes", by: "ai" }]);
  });
  it("never lets the AI answer about pay, visas, rights, identity or the law", async () => {
    const r = await answerForExtension([{ question: "Will you require visa sponsorship?", options: ["Yes", "No"], kind: "radio" }, { question: "What is your expected salary?", options: [], kind: "text" }, { question: "Do you consent to a background check?", options: ["Yes", "No"], kind: "radio" }]);
    expect(r.map((x) => x.answer)).toEqual([null, null, null]);
    expect(world.prompts).toEqual([]);
  });
  it("refuses an answer that is not one of the options, or states a figure that is not in the profile, and does not retry it today", async () => {
    world.reply = "Probably";
    expect((await answerForExtension([{ question: "Are you fluent in English?", options: ["Yes", "No"], kind: "radio" }]))[0]).toMatchObject({ answer: null, why: "the answer was not one of the options" });
    world.reply = "I have 25 years of experience leading teams of 400 people";
    expect((await answerForExtension([{ question: "Describe your leadership experience", options: [], kind: "text" }]))[0]).toMatchObject({ answer: null, why: "the draft stated a figure that is not in your profile" });
    world.prompts = [];
    expect((await answerForExtension([{ question: "Describe your leadership experience", options: [], kind: "text" }]))[0]).toMatchObject({ answer: null, why: "the AI could not answer it earlier today" });
    expect(world.prompts).toEqual([]);
    expect(world.saved).toEqual([]);
  });
  it("leaves it for you when no model answers, or the profile is empty, and names a field only you may type as such", async () => {
    world.reply = new Error("all models busy");
    expect((await answerForExtension([{ question: "Are you fluent in English?", options: ["Yes", "No"], kind: "radio" }]))[0]).toMatchObject({ answer: null, why: expect.stringContaining("no model could answer it") });
    world.reply = "Yes"; world.profileEmpty = true;
    expect((await answerForExtension([{ question: "Are you fluent in French?", options: ["Yes", "No"], kind: "radio" }]))[0]).toMatchObject({ answer: null, why: "your profile is empty" });
    expect((await answerForExtension([{ question: "Passport number", options: [], kind: "text" }]))[0]).toMatchObject({ answer: null });
  });
});
