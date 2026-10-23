import { MasterProfile } from "@/lib/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { reply: "" as string | Error, tried: {} as Record<string, string>, saved: [] as { question: string; answer: string; appIds: string[]; by: string }[], asked: [] as string[] };
const profile = MasterProfile.parse({ basics: { name: "A B" }, preferences: { countries: [], roles: [] }, experience: [{ id: "e1", title: "PM", company: "Acme", start: "2015", end: "2024", bullets: [{ id: "b1", text: "Led a team of 8 to launch a payments product" }] }] });
const group = (question: string, ids: string[] = ["a1"]) => ({ key: question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), question, count: ids.length, apps: ids.map((id) => ({ id, title: "Head of Ops", company: "Cygnify" })), countries: [] });
let groups = [group("Describe your experience leading teams")];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/profile/store", () => ({ getProfile: async () => profile }));
vi.mock("@/lib/apply/handbacks-store", () => ({ loadHandbacks: async () => groups }));
vi.mock("@/lib/db", () => ({ must: (r: { data: unknown }) => r.data, db: () => ({ from: () => ({ select: () => ({ limit: () => ({ data: [{ question: "What is your notice period?", answer: "60 days" }] }) }) }) }) }));
vi.mock("@/lib/settings", () => ({ getSetting: async () => state.tried, putSetting: async (_k: string, v: Record<string, string>) => { state.tried = v; } }));
vi.mock("@/lib/apply/save-answer", () => ({ saveAnswerAndRequeue: async (o: { question: string; answer: string; appIds: string[]; by: string }) => { state.saved.push(o); return { requeued: o.appIds.length }; } }));
vi.mock("@/lib/llm/registry", () => ({ runText: async (o: { prompt: string }) => { state.asked.push(o.prompt); if (state.reply instanceof Error) throw state.reply; return { text: state.reply, model: "m", tier: "strong" }; } }));

import { answerWaitingQuestions, LEFT_FOR_YOU } from "@/lib/apply/answer-waiting";
const run = () => answerWaitingQuestions({ budgetMs: 60_000, sequential: true });

describe("the cloud answers what the assistant could not", () => {
  beforeEach(() => { state.reply = "I led a team of 8 at Acme to launch a payments product, delivering it on time."; state.tried = {}; state.saved = []; state.asked = []; groups = [group("Describe your experience leading teams")]; });

  it("writes an answer from the profile, saves it for every waiting application, and says so", async () => {
    groups = [group("Describe your experience leading teams", ["a1", "a2"])];
    const r = await run();
    expect(r).toMatchObject({ answered: 1, requeued: 2, left: [] });
    expect(state.saved).toEqual([{ question: "Describe your experience leading teams", answer: state.reply, country: null, appIds: ["a1", "a2"], by: "ai" }]);
    expect(state.asked[0]).toMatch(/FACTS:[\s\S]*Led a team of 8[\s\S]*ANSWER BANK:\n- What is your notice period\?: 60 days[\s\S]*QUESTION: Describe your experience leading teams/);
  });
  it("never guesses about pay, visas, identity or the law", async () => {
    for (const q of ["What is your expected salary?", "Do you require visa sponsorship?", "What is your gender?", "Are you a US citizen?", "Notice period", "Have you been convicted of a crime?"]) expect(LEFT_FOR_YOU.test(q), q).toBe(true);
    groups = [group("Do you require visa sponsorship?")];
    const r = await run();
    expect(r.answered).toBe(0);
    expect(r.left[0].why).toMatch(/pay, rights, identity or the law/);
    expect(state.asked).toHaveLength(0);
  });
  it("leaves a question the profile cannot answer, a made-up figure and a placeholder, and does not ask again for a day", async () => {
    state.reply = "NO_ANSWER";
    expect((await run()).left[0].why).toMatch(/does not answer it/);
    expect(Object.keys(state.tried)).toHaveLength(1);
    state.asked = [];
    expect((await run()).left[0].why).toMatch(/already could not answer it today/);
    expect(state.asked).toHaveLength(0);
    state.tried = {}; state.reply = "I grew revenue by 60% by leading a team of 8 at Acme on a payments product.";
    expect((await run()).left[0].why).toMatch(/figure that is not in your profile/);
    state.tried = {}; state.reply = "I would love to join [COMPANY] and lead teams of 8 as I did at Acme on payments.";
    expect((await run()).left[0].why).toMatch(/placeholder/);
    expect(state.saved).toHaveLength(0);
  });
  it("turns a number question's answer into a number, and reports a model failure in the models' own words", async () => {
    groups = [group("How many people have you managed?")];
    state.reply = "8 people";
    await run();
    expect(state.saved[0].answer).toBe("8");
    state.saved = []; state.tried = {}; state.reply = new Error("All models failed for task \"tailor\": gemini: HTTP 429 | ollama-local: fetch failed");
    const r = await run();
    expect(r.errors[0]).toMatch(/ollama-local: fetch failed/);
    expect(r.left[0].why).toBe("no model could write it");
  });
});
