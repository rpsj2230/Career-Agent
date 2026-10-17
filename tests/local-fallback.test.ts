import { describe, expect, it } from "vitest";
import { LOCAL_TIMEOUT_MS, selectCandidates, timeoutFor, withLocalFallback, type ModelRow } from "@/lib/llm/fallback";

const row = (label: string, provider: string, priority: number, o: Partial<ModelRow> = {}): ModelRow => ({ id: label, label, provider, base_url: "https://x/v1", model: "m", api_key_env: label === "ollama-local" ? null : "K", tasks: ["score", "tailor", "extract"], priority, daily_cap: null, enabled: true, ...o });
const rows = [row("gemini", "google", 10), row("groq", "groq", 20), row("ollama-local", "ollama", 90, { enabled: false, base_url: "http://localhost:11434/v1", model: "llama3.1:8b", tasks: ["extract"], daily_cap: 5 })];
const chain = (env: Record<string, string>) => selectCandidates(withLocalFallback(rows, env), "tailor", () => true, {}).map((m) => m.label);

describe("local model as the final fallback", () => {
  it("is not attempted when no local model is configured", () => expect(chain({})).toEqual(["gemini", "groq"]));
  it("comes last for every task once LOCAL_MODEL is set", () => expect(chain({ LOCAL_MODEL: "qwen2.5:7b-instruct" })).toEqual(["gemini", "groq", "ollama-local"]));
  it("uses the configured model, the runner's address and ignores the daily cap", () => {
    const l = withLocalFallback(rows, { LOCAL_MODEL: "qwen2.5:7b-instruct" }).find((m) => m.provider === "ollama")!;
    expect(l).toMatchObject({ model: "qwen2.5:7b-instruct", base_url: "http://127.0.0.1:11434/v1", daily_cap: null });
  });
  it("is still last when every hosted model is out of quota, and the only one left", () => {
    const capped = rows.map((m) => (m.provider === "ollama" ? m : { ...m, daily_cap: 1 }));
    const c = selectCandidates(withLocalFallback(capped, { LOCAL_MODEL: "q" }), "score", () => true, { gemini: 1, groq: 1 });
    expect(c.map((m) => m.label)).toEqual(["ollama-local"]);
  });
  it("gives only the local model a long timeout", () => {
    expect(timeoutFor({ provider: "ollama" })).toBe(LOCAL_TIMEOUT_MS);
    expect(timeoutFor({ provider: "google" })).toBeUndefined();
  });
});

describe("runner-only model", () => {
  it("is flagged when the website would call a localhost address", async () => {
    const { isRunnerOnlyModel } = await import("@/lib/llm/fallback");
    expect(isRunnerOnlyModel({ provider: "ollama", base_url: "http://127.0.0.1:11434/v1" }, {})).toBe(true);
    expect(isRunnerOnlyModel({ provider: "ollama", base_url: "" }, {})).toBe(true);
    expect(isRunnerOnlyModel({ provider: "ollama", base_url: "http://127.0.0.1:11434/v1" }, { LOCAL_MODEL: "qwen2.5:3b" })).toBe(false);
    expect(isRunnerOnlyModel({ provider: "ollama", base_url: "https://ollama.example.com/v1" }, {})).toBe(false);
    expect(isRunnerOnlyModel({ provider: "google", base_url: "" }, {})).toBe(false);
  });
});
