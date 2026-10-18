import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS } from "@/lib/llm/defaults";

describe("default models", () => {
  it("have unique labels", () => {
    const labels = DEFAULT_MODELS.map((m) => m.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
  it("offer slots 2 to 5 for Gemini, Groq and Mistral keys", () => {
    for (const env of ["GEMINI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY"]) {
      for (let slot = 2; slot <= 5; slot++) expect(DEFAULT_MODELS.some((m) => m.api_key_env === `${env}_${slot}`), `${env}_${slot}`).toBe(true);
    }
  });
  it("every hosted model names a key variable and a valid https address", () => {
    for (const m of DEFAULT_MODELS) { expect(m.api_key_env, m.label).toBeTruthy(); expect(m.base_url, m.label).toMatch(/^https:\/\//); }
  });
});
