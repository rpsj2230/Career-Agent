import { MasterProfile } from "@/lib/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saved: { table: string; rows: Record<string, unknown> }[] = [];
const state = { have: [] as { key: string; answer: string }[], mode: "good" as "good" | "fail" | "noanswer" | "invented" | "fenced", lastSetting: null as unknown, prompts: [] as string[] };
const profile = MasterProfile.parse({ basics: { name: "A B" }, preferences: { countries: [], roles: [] }, experience: [{ id: "e1", title: "PM", company: "Acme", start: "2015", end: "2024", bullets: [{ id: "b1", text: "Led a team of 8 to launch a payments product" }] }] });

vi.mock("@/lib/profile/store", () => ({ getProfile: async () => profile }));
vi.mock("@/lib/activity-helpers", () => ({ logConfig: async () => undefined }));
vi.mock("@/lib/settings", () => ({ putSetting: async (_k: string, v: unknown) => { state.lastSetting = v; } }));
vi.mock("@/lib/db", () => ({
  must: (r: { data: unknown }) => r.data,
  db: () => ({ from: (table: string) => ({
    select: () => ({ data: state.have }),
    upsert: (row: Record<string, unknown>) => { saved.push({ table, rows: row }); return { select: () => ({ data: row }) }; },
  }) }),
}));
vi.mock("@/lib/llm/registry", () => ({
  runText: async (o: { prompt: string }) => {
    state.prompts.push(o.prompt);
    if (state.mode === "fail") throw new Error("All models failed for task \"tailor\": gemini-flash-lite: HTTP 429 | ollama-local: connection refused");
    if (state.mode === "noanswer") return { text: "NO_ANSWER", model: "m", tier: "strong" };
    if (state.mode === "invented") return { text: "I grew revenue by 60% in two years by leading a team of 8 on a payments product.", model: "m", tier: "strong" };
    if (state.mode === "fenced") return { text: "Here is my answer:\n\"I led a team of 8 at Acme to launch a payments product, which shows I can deliver with a small team.\"", model: "m", tier: "strong" };
    return { text: "I led a team of 8 at Acme to launch a payments product, so I bring practical delivery experience.", model: "m", tier: "strong" };
  },
}));

import { answerKey, draftInterviewAnswers } from "@/lib/autofill/draft-answers";
import { WRITTEN_QUESTIONS } from "@/lib/standard-questions";

const ok = async (o: Parameters<typeof draftInterviewAnswers>[0]) => { const r = await draftInterviewAnswers(o); if ("error" in r) throw new Error(r.error); return r; };

describe("drafting the interview answers", () => {
  beforeEach(() => { saved.length = 0; state.have = []; state.mode = "good"; state.lastSetting = null; state.prompts = []; });

  it("asks one question per request, as plain text, and saves every usable answer", async () => {
    const r = await ok({ budgetMs: 60_000, sequential: true });
    expect(r.written).toBe(WRITTEN_QUESTIONS.length);
    expect(state.prompts).toHaveLength(WRITTEN_QUESTIONS.length);
    expect(state.prompts[0]).toMatch(/QUESTION: Why are you interested in this role\?/);
    expect(saved.map((s) => s.rows.key)).toEqual(WRITTEN_QUESTIONS.map(answerKey));
  });

  it("tells you why nothing was written, with the models' own words, and remembers it for the Profile page", async () => {
    state.mode = "fail";
    const r = await ok({ budgetMs: 60_000, sequential: true });
    expect(r.written).toBe(0);
    expect(r.dropped).toHaveLength(WRITTEN_QUESTIONS.length);
    expect(r.errors).toHaveLength(1); // the same failure is said once, not nineteen times
    expect(r.errors[0]).toMatch(/gemini-flash-lite: HTTP 429 \| ollama-local: connection refused/);
    expect(saved).toHaveLength(0);
    expect(state.lastSetting).toMatchObject({ written: 0, where: "github", errors: [expect.stringContaining("connection refused")] });
  });

  it("drops an answer with a made-up figure, a NO_ANSWER, and cleans a model's 'Here is my answer' wrapper", async () => {
    state.mode = "invented";
    expect((await ok({ budgetMs: 60_000, sequential: true })).dropped[0].why).toMatch(/"60%", which is not in your profile/);
    state.mode = "noanswer";
    expect((await ok({ budgetMs: 60_000, sequential: true })).dropped[0].why).toMatch(/does not give enough/);
    state.mode = "fenced"; saved.length = 0;
    await ok({ budgetMs: 60_000, sequential: true });
    expect(saved[0].rows.answer).toBe("I led a team of 8 at Acme to launch a payments product, which shows I can deliver with a small team.");
  });

  it("never touches an answer you already wrote, in either mode", async () => {
    state.have = [{ key: answerKey(WRITTEN_QUESTIONS[0]), answer: "mine" }];
    for (const sequential of [true, false]) {
      saved.length = 0;
      const r = await ok({ budgetMs: 60_000, sequential });
      expect(saved.map((s) => s.rows.key)).not.toContain(answerKey(WRITTEN_QUESTIONS[0]));
      expect(r.written + r.dropped.length).toBe(WRITTEN_QUESTIONS.length - 1);
    }
  });

  it("stops at its time limit and says which were not reached", async () => {
    const r = await ok({ budgetMs: 1, sequential: true });
    expect(r.written).toBe(0);
    expect(r.dropped.every((d) => /not reached before the time limit/.test(d.why))).toBe(true);
  });
});
