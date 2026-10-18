import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS } from "@/lib/llm/defaults";

describe("default models", () => {
  it("have unique labels", () => {
    const labels = DEFAULT_MODELS.map((m) => m.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
  it("have no per-key slot rows (keys are a pool per provider)", () => {
    expect(DEFAULT_MODELS.some((m) => /_\d+$/.test(m.api_key_env ?? ""))).toBe(false);
  });
  it("every hosted model names a key variable and a valid https address", () => {
    for (const m of DEFAULT_MODELS) { expect(m.api_key_env, m.label).toBeTruthy(); expect(m.base_url, m.label).toMatch(/^https:\/\//); }
  });
});
