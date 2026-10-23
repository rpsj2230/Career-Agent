import { MasterProfile } from "@/lib/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saved: { table: string; rows: unknown }[] = [];
const state = { have: [] as { key: string; answer: string }[], failModels: false };
const profile = MasterProfile.parse({ basics: { name: "A B" }, preferences: { countries: [], roles: [] }, experience: [{ id: "e1", title: "PM", company: "Acme", start: "2015", end: "2024", bullets: [{ id: "b1", text: "Led a team of 8 to launch a payments product" }] }] });

vi.mock("@/lib/profile/store", () => ({ getProfile: async () => profile }));
vi.mock("@/lib/activity-helpers", () => ({ logConfig: async () => undefined }));
vi.mock("@/lib/db", () => ({
  must: (r: { data: unknown }) => r.data,
  db: () => ({ from: (table: string) => ({
    select: () => ({ data: state.have }),
    upsert: (rows: unknown) => { saved.push({ table, rows }); return { select: () => ({ data: rows }) }; },
  }) }),
}));
vi.mock("@/lib/llm/registry", () => ({
  runStructured: async (o: { prompt: string }) => {
    if (state.failModels) throw new Error("All models failed");
    const idx = [...o.prompt.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    return { output: { answers: idx.map((index) => ({ index, answer: "I led a team of 8 at Acme." })) } };
  },
}));

import { answerKey, draftInterviewAnswers } from "@/lib/autofill/draft-answers";
import { WRITTEN_QUESTIONS } from "@/lib/standard-questions";

describe("drafting the interview answers", () => {
  beforeEach(() => { saved.length = 0; state.have = []; state.failModels = false; });

  it("says which questions it left for you when no model could write them, and saves nothing", async () => {
    state.failModels = true;
    const r = await draftInterviewAnswers({ budgetMs: 1000, sequential: true });
    if ("error" in r) throw new Error(r.error);
    expect(r.written).toBe(0);
    expect(r.dropped).toHaveLength(WRITTEN_QUESTIONS.length);
    expect(r.dropped[0].why).toMatch(/no model could write it/);
    expect(saved).toHaveLength(0);
  });

  it("never touches an answer you already wrote, in either mode", async () => {
    state.have = [{ key: answerKey(WRITTEN_QUESTIONS[0]), answer: "mine" }];
    for (const sequential of [true, false]) {
      saved.length = 0;
      const r = await draftInterviewAnswers({ budgetMs: 1000, sequential });
      if ("error" in r) throw new Error(r.error);
      const keys = (saved.flatMap((s) => s.rows as { key: string }[])).map((x) => x.key);
      expect(keys).not.toContain(answerKey(WRITTEN_QUESTIONS[0]));
      expect(r.written + r.dropped.length).toBe(WRITTEN_QUESTIONS.length - 1);
    }
  });
});
