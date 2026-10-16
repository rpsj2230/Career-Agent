import { describe, expect, it } from "vitest";
import { AllModelsFailed, runWithFallback, selectCandidates, type ModelRow } from "@/lib/llm/fallback";

const row = (o: Partial<ModelRow>): ModelRow => ({
  id: o.label ?? "x", label: "x", provider: "p", base_url: "u", model: "m", api_key_env: "K",
  tasks: ["score", "tailor", "extract"], priority: 10, daily_cap: null, enabled: true, ...o,
});

describe("selectCandidates", () => {
  const rows = [
    row({ label: "a", priority: 20, api_key_env: "A" }),
    row({ label: "b", priority: 10, api_key_env: "B" }),
    row({ label: "nokey", priority: 1, api_key_env: "MISSING" }),
    row({ label: "off", priority: 2, enabled: false, api_key_env: "A" }),
    row({ label: "capped", priority: 3, api_key_env: "A", daily_cap: 2 }),
    row({ label: "scoreonly", priority: 4, api_key_env: "A", tasks: ["score"] }),
    row({ label: "local", priority: 50, api_key_env: null }),
  ];
  const env: Record<string, string> = { A: "1", B: "1" };
  const hasKey = (m: ModelRow) => m.api_key_env === null || !!env[m.api_key_env];
  it("filters and orders by priority", () => {
    expect(selectCandidates(rows, "tailor", hasKey, { capped: 2 }).map((m) => m.label)).toEqual(["b", "a", "local"]);
  });
  it("respects task and a cap that is not yet reached", () => {
    expect(selectCandidates(rows, "score", hasKey, { capped: 1 }).map((m) => m.label)).toEqual(["capped", "scoreonly", "b", "a", "local"]);
  });
});

describe("runWithFallback", () => {
  const cands = [row({ label: "first" }), row({ label: "second" })];
  it("falls through failures and logs each attempt", async () => {
    const log: string[] = [];
    const r = await runWithFallback("score", cands, async (m) => {
      if (m.label === "first") throw new Error("429 rate limit");
      return "ok";
    }, (m, ok) => { log.push(`${m.label}:${ok}`); });
    expect(r.value).toBe("ok");
    expect(r.used.label).toBe("second");
    expect(log).toEqual(["first:false", "second:true"]);
  });
  it("throws a descriptive error when all fail or none exist", async () => {
    await expect(runWithFallback("score", cands, async () => { throw new Error("boom"); })).rejects.toBeInstanceOf(AllModelsFailed);
    await expect(runWithFallback("score", [], async () => 1)).rejects.toThrow(/No model available/);
  });
});
