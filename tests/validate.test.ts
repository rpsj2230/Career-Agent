import { describe, expect, it } from "vitest";
import { ModelInput } from "@/lib/llm/validate";

const ok = { label: "my-model", provider: "groq", base_url: "https://api.groq.com/openai/v1", model: "x", api_key_env: "GROQ_API_KEY", tasks: ["score"], priority: 10, daily_cap: null, enabled: true };

describe("ModelInput", () => {
  it("accepts a normal provider row and a local Ollama row", () => {
    expect(ModelInput.safeParse(ok).success).toBe(true);
    expect(ModelInput.safeParse({ ...ok, base_url: "http://localhost:11434/v1", api_key_env: null }).success).toBe(true);
  });
  it("refuses secrets that are not provider keys", () => {
    for (const n of ["SUPABASE_SERVICE_ROLE_KEY", "APP_PASSWORD", "CRON_SECRET", "GITHUB_DISPATCH_TOKEN", "PATH", "lowercase_key"]) {
      expect(ModelInput.safeParse({ ...ok, api_key_env: n }).success, n).toBe(false);
    }
  });
  it("refuses plain-http remote hosts and junk URLs", () => {
    expect(ModelInput.safeParse({ ...ok, base_url: "http://evil.example.com/v1" }).success).toBe(false);
    expect(ModelInput.safeParse({ ...ok, base_url: "javascript:alert(1)" }).success).toBe(false);
  });
});
