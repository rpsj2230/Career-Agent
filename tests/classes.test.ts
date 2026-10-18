import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS } from "@/lib/llm/defaults";
import { modelClass } from "@/lib/llm/classes";

const c = (model: string) => modelClass({ model });

describe("modelClass", () => {
  it("puts the large models in strong", () => {
    for (const m of ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "mistral-large-latest", "Meta-Llama-3.3-70B-Instruct", "moonshotai/kimi-k2-instruct-0905", "qwen-plus", "command-r-plus"]) expect(c(m), m).toBe("strong");
  });
  it("puts the all-rounders in medium", () => {
    for (const m of ["gemini-flash-latest", "gemini-2.5-flash", "qwen/qwen3-32b", "openai/gpt-oss-20b", "mistral-small-latest", "meta-llama/llama-4-scout-17b-16e-instruct", "glm-4.7-flash", "nvidia/llama-3.3-nemotron-super-49b-v1"]) expect(c(m), m).toBe("medium");
  });
  it("puts the light models in small", () => {
    for (const m of ["gemini-flash-lite-latest", "gemini-2.5-flash-lite", "llama-3.1-8b-instant", "open-mistral-nemo", "ministral-8b-latest", "Qwen/Qwen3-8B", "openai/gpt-4.1-mini"]) expect(c(m), m).toBe("small");
  });
  it("classifies every default model into some group", () => {
    for (const m of DEFAULT_MODELS) expect(["strong", "medium", "small"]).toContain(modelClass(m));
  });
});

import { groupByProvider, providerName } from "@/lib/llm/classes";
describe("groupByProvider", () => {
  const rows = [
    { provider: "groq", priority: 20, k: false }, { provider: "google", priority: 10, k: true }, { provider: "Groq", priority: 18, k: false }, { provider: "mistral", priority: 50, k: true },
  ];
  it("groups case-insensitively, orders rows by priority and puts providers with something ready first", () => {
    const g = groupByProvider(rows, (r) => r.k);
    expect(g.map((x) => x.name)).toEqual(["Google Gemini", "Mistral", "Groq"]);
    expect(g[2].rows.map((r) => r.priority)).toEqual([18, 20]);
  });
  it("has readable names and a fallback", () => {
    expect(providerName("sambanova")).toBe("SambaNova");
    expect(providerName("newco")).toBe("Newco");
  });
});
