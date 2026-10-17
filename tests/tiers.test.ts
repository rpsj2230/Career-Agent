import { describe, expect, it } from "vitest";
import { defaultPrefer, orderForTier, tierOf } from "@/lib/llm/tiers";
import { buildBatchPrompt } from "@/lib/score/prompt";
import { MasterProfile } from "@/lib/types";

const m = (label: string, model: string, priority: number) => ({ label, model, priority });
const chain = [m("gemini-flash", "gemini-flash-latest", 10), m("gemini-flash-lite", "gemini-flash-lite-latest", 12), m("groq-llama", "llama-3.3-70b-versatile", 20), m("groq-gpt-oss", "openai/gpt-oss-120b", 18), m("mistral-small", "mistral-small-latest", 50)];

describe("model tiers", () => {
  it("guesses fast and strong from the name, and your override wins", () => {
    expect(tierOf(chain[0])).toBe("fast");
    expect(tierOf(chain[2])).toBe("strong");
    expect(tierOf(chain[3])).toBe("strong");
    expect(tierOf(chain[2], { "groq-llama": "fast" })).toBe("fast");
  });
  it("scoring tries fast models first, writing tries strong ones first, and each keeps your priority order", () => {
    expect(orderForTier(chain, defaultPrefer("score")).map((x) => x.label)).toEqual(["gemini-flash", "gemini-flash-lite", "mistral-small", "groq-gpt-oss", "groq-llama"]);
    expect(orderForTier(chain, defaultPrefer("tailor")).map((x) => x.label)).toEqual(["groq-gpt-oss", "groq-llama", "gemini-flash", "gemini-flash-lite", "mistral-small"]);
  });
  it("never drops a model, so every one is still a fallback", () => {
    expect(orderForTier(chain, "strong")).toHaveLength(chain.length);
  });
  it("does not change the list it is given", () => {
    const before = chain.map((x) => x.label);
    orderForTier(chain, "strong");
    expect(chain.map((x) => x.label)).toEqual(before);
  });
});

describe("batch prompt", () => {
  const profile = MasterProfile.parse({ basics: { headline: "PM" }, experience: [{ id: "e", company: "Acme", title: "PM", bullets: [] }], skills: [{ id: "s", name: "SQL" }] });
  const job = (t: string) => ({ title: t, company: "X", country: "sg", location: "Singapore", description: "d ".repeat(5000), salary_text: null });
  it("sends the candidate once, and every job with its id", () => {
    const p = buildBatchPrompt(profile, [{ id: "a", job: job("A") }, { id: "b", job: job("B") }, { id: "c", job: job("C") }]);
    expect(p.match(/CANDIDATE/g)).toHaveLength(1);
    for (const id of ["a", "b", "c"]) expect(p).toContain(`(id: ${id})`);
  });
  it("shares a bounded amount of description between the jobs, so a big batch stays affordable", () => {
    const four = buildBatchPrompt(profile, ["a", "b", "c", "d"].map((id) => ({ id, job: job(id) })));
    const one = buildBatchPrompt(profile, [{ id: "a", job: job("a") }]);
    expect(four.length).toBeLessThan(one.length * 2.2);
  });
});
