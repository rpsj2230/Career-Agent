import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { callStructured, repairJson } from "@/lib/llm/call";
import { CoverLetter, JobScore, roundScore, TailoredResume } from "@/lib/types";
import { z } from "zod";

const reply = (text: string) => new MockLanguageModelV4({
  doGenerate: async () => ({
    content: [{ type: "text", text }], finishReason: { unified: "stop", raw: "stop" },
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [],
  }),
});
const score = (text: string) => callStructured(reply(text), { schema: JobScore, system: "s", prompt: "p" });

describe("repairJson", () => {
  it("strips code fences, surrounding prose and trailing commas", () => {
    expect(JSON.parse(repairJson('Sure! Here you go:\n```json\n{"a": 1, "b": [1,2,],}\n```\nHope that helps')!)).toEqual({ a: 1, b: [1, 2] });
  });
  it("returns null when there is no object", () => {
    expect(repairJson("I cannot do that")).toBeNull();
    expect(repairJson("{ not json")).toBeNull();
  });
});

describe("sloppy model output is rescued", () => {
  it("accepts clean JSON", async () => expect((await score('{"score": 82, "summary": "good"}')).output.score).toBe(82));
  it("accepts a fenced answer with chatter", async () => expect((await score('Here is the assessment:\n```json\n{"score": 71, "summary": "ok"}\n```')).output.score).toBe(71));
  it("accepts a score sent as text or with decimals, and fills missing lists", async () => {
    const r = (await score('{"score": "82.5", "summary": "x"}')).output;
    expect(r.score).toBe(82.5);
    expect(roundScore(r.score)).toBe(83);
    expect(r).toMatchObject({ matchedSkills: [], gaps: [], seniorityFit: "unknown" });
  });
  it("still rejects a score outside 0 to 100 or no score at all", async () => {
    await expect(score('{"score": 140}')).rejects.toThrow();
    await expect(score('{"summary": "no score"}')).rejects.toThrow();
  });
  it("rejects prose with no JSON, so the next model is tried", async () => {
    await expect(score("I think it is a decent match.")).rejects.toThrow();
  });
});

describe("a hung model is cut off", () => {
  it("fails after the timeout instead of waiting forever", async () => {
    const hung = new MockLanguageModelV4({ doGenerate: () => new Promise(() => undefined) });
    const t0 = Date.now();
    await expect(callStructured(hung, { schema: z.object({ a: z.string() }), system: "s", prompt: "p", timeoutMs: 150 })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe("resume and cover-letter schemas forgive missing lists (the verifier reports the gap instead)", () => {
  it("fills empty lists", () => {
    const r = TailoredResume.parse({ summary: { text: "x" }, experience: [{ experienceId: "e1", bullets: [{ text: "did a thing" }] }] });
    expect(r).toMatchObject({ headline: "", skillIds: [], certificationIds: [] });
    expect(r.summary.sourceIds).toEqual([]);
    expect(r.experience[0].bullets[0].sourceIds).toEqual([]);
    expect(CoverLetter.parse({ text: "hello" }).sourceIds).toEqual([]);
  });
  it("still requires the actual text", () => {
    expect(TailoredResume.safeParse({ summary: {} }).success).toBe(false);
    expect(CoverLetter.safeParse({}).success).toBe(false);
  });
  it("their JSON schemas can be produced (the SDK needs this)", () => {
    for (const s of [TailoredResume, CoverLetter, JobScore]) expect(() => z.toJSONSchema(s, { io: "input" })).not.toThrow();
  });
});

describe("what the model is told", () => {
  it("always spells out the structure and mentions JSON (Groq refuses JSON mode otherwise)", async () => {
    let seen = "";
    const spy = new MockLanguageModelV4({
      doGenerate: async (opts) => {
        seen = JSON.stringify(opts.prompt);
        return { content: [{ type: "text", text: '{"answer":"4"}' }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [] };
      },
    });
    await callStructured(spy, { schema: z.object({ answer: z.string() }), system: "Be brief.", prompt: "2+2?" });
    expect(seen).toMatch(/JSON/);
    expect(seen).toContain("properties");
    expect(seen).toContain("answer");
  });
});
