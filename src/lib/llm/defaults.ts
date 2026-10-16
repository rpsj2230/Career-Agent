import type { ModelRow } from "./fallback";

/** Models the app guarantees exist. Verified-working ids only; add more from the Models page. */
export const DEFAULT_MODELS: Omit<ModelRow, "id">[] = [
  { label: "gemini-flash", provider: "google", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash-latest", api_key_env: "GEMINI_API_KEY", tasks: ["score", "tailor", "extract"], priority: 10, daily_cap: 200, enabled: true },
  { label: "gemini-flash-lite", provider: "google", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash-lite-latest", api_key_env: "GEMINI_API_KEY", tasks: ["score", "tailor", "extract"], priority: 12, daily_cap: 300, enabled: true },
  { label: "groq-llama", provider: "groq", base_url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", api_key_env: "GROQ_API_KEY", tasks: ["score", "tailor", "extract"], priority: 20, daily_cap: 500, enabled: true },
];
