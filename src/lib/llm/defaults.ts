import type { ModelRow } from "./fallback";

/** Models the app guarantees exist. Verified-working ids only; add more from the Models page. */
export const DEFAULT_MODELS: Omit<ModelRow, "id">[] = [
  { label: "gemini-flash", provider: "google", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash-latest", api_key_env: "GEMINI_API_KEY", tasks: ["score", "tailor", "extract"], priority: 10, daily_cap: 200, enabled: true },
  { label: "gemini-flash-lite", provider: "google", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash-lite-latest", api_key_env: "GEMINI_API_KEY", tasks: ["score", "tailor", "extract"], priority: 12, daily_cap: 300, enabled: true },
  { label: "groq-llama", provider: "groq", base_url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", api_key_env: "GROQ_API_KEY", tasks: ["score", "tailor", "extract"], priority: 20, daily_cap: 500, enabled: true },
  // Added after a 2026 review of free tiers. A row without a key is skipped automatically; use the Test button on the Models page
  // to confirm each id works for you (provider limits and model names change often).
  { label: "groq-gpt-oss", provider: "groq", base_url: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", api_key_env: "GROQ_API_KEY", tasks: ["score", "tailor", "extract"], priority: 18, daily_cap: 400, enabled: true },
  { label: "nvidia-llama", provider: "nvidia", base_url: "https://integrate.api.nvidia.com/v1", model: "meta/llama-3.3-70b-instruct", api_key_env: "NVIDIA_API_KEY", tasks: ["score", "tailor", "extract"], priority: 35, daily_cap: 500, enabled: true },
  { label: "openrouter-free", provider: "openrouter", base_url: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free", api_key_env: "OPENROUTER_API_KEY", tasks: ["score", "tailor", "extract"], priority: 40, daily_cap: 45, enabled: true },
  // More separate daily quotas from providers you may already have a key for. Each model has its own free allowance, so adding models
  // from the same provider multiplies the capacity without another account. A row without a key is skipped; use Test to confirm an id.
  { label: "gemini-25-flash", provider: "google", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", api_key_env: "GEMINI_API_KEY", tasks: ["score", "tailor", "extract"], priority: 11, daily_cap: 200, enabled: true },
  { label: "gemini-25-flash-lite", provider: "google", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash-lite", api_key_env: "GEMINI_API_KEY", tasks: ["score", "extract"], priority: 13, daily_cap: 300, enabled: true },
  { label: "groq-qwen3", provider: "groq", base_url: "https://api.groq.com/openai/v1", model: "qwen/qwen3-32b", api_key_env: "GROQ_API_KEY", tasks: ["score", "tailor", "extract"], priority: 21, daily_cap: 400, enabled: true },
  { label: "groq-gpt-oss-20b", provider: "groq", base_url: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-20b", api_key_env: "GROQ_API_KEY", tasks: ["score", "extract"], priority: 22, daily_cap: 500, enabled: true },
  { label: "groq-llama4-scout", provider: "groq", base_url: "https://api.groq.com/openai/v1", model: "meta-llama/llama-4-scout-17b-16e-instruct", api_key_env: "GROQ_API_KEY", tasks: ["score", "tailor", "extract"], priority: 23, daily_cap: 400, enabled: true },
  { label: "cerebras-gpt-oss", provider: "cerebras", base_url: "https://api.cerebras.ai/v1", model: "gpt-oss-120b", api_key_env: "CEREBRAS_API_KEY", tasks: ["score", "tailor", "extract"], priority: 25, daily_cap: 400, enabled: true },
  { label: "sambanova-llama", provider: "sambanova", base_url: "https://api.sambanova.ai/v1", model: "Meta-Llama-3.3-70B-Instruct", api_key_env: "SAMBANOVA_API_KEY", tasks: ["score", "tailor", "extract"], priority: 28, daily_cap: 20, enabled: true },
  { label: "github-models", provider: "github", base_url: "https://models.github.ai/inference", model: "openai/gpt-4.1-mini", api_key_env: "GITHUB_MODELS_TOKEN", tasks: ["score", "tailor", "extract"], priority: 45, daily_cap: 100, enabled: true },
  // Further free tiers reported in October 2026 roundups. Limits and model names change often and some need an account check, so confirm each with Test.
  { label: "zai-glm-flash", provider: "zai", base_url: "https://api.z.ai/api/paas/v4", model: "glm-4.7-flash", api_key_env: "ZAI_API_KEY", tasks: ["score", "tailor", "extract"], priority: 55, daily_cap: 300, enabled: true },
  { label: "siliconflow-qwen3-8b", provider: "siliconflow", base_url: "https://api.siliconflow.com/v1", model: "Qwen/Qwen3-8B", api_key_env: "SILICONFLOW_API_KEY", tasks: ["score", "extract"], priority: 56, daily_cap: 400, enabled: true },
  { label: "cohere-command", provider: "cohere", base_url: "https://api.cohere.ai/compatibility/v1", model: "command-r-plus", api_key_env: "COHERE_API_KEY", tasks: ["score", "tailor", "extract"], priority: 57, daily_cap: 30, enabled: true },
  // Still more separate allowances (each model has its own). Confirm each with Test; a failing model is skipped automatically and tried last.
  { label: "groq-llama-instant", provider: "groq", base_url: "https://api.groq.com/openai/v1", model: "llama-3.1-8b-instant", api_key_env: "GROQ_API_KEY", tasks: ["score", "extract"], priority: 24, daily_cap: 800, enabled: true },
  { label: "groq-kimi-k2", provider: "groq", base_url: "https://api.groq.com/openai/v1", model: "moonshotai/kimi-k2-instruct-0905", api_key_env: "GROQ_API_KEY", tasks: ["score", "tailor", "extract"], priority: 26, daily_cap: 300, enabled: true },
  { label: "mistral-ministral-8b", provider: "mistral", base_url: "https://api.mistral.ai/v1", model: "ministral-8b-latest", api_key_env: "MISTRAL_API_KEY", tasks: ["score", "extract"], priority: 53, daily_cap: 300, enabled: true },
  { label: "nvidia-nemotron", provider: "nvidia", base_url: "https://integrate.api.nvidia.com/v1", model: "nvidia/llama-3.3-nemotron-super-49b-v1", api_key_env: "NVIDIA_API_KEY", tasks: ["score", "tailor", "extract"], priority: 36, daily_cap: 400, enabled: true },
  { label: "nvidia-llama-31-70b", provider: "nvidia", base_url: "https://integrate.api.nvidia.com/v1", model: "meta/llama-3.1-70b-instruct", api_key_env: "NVIDIA_API_KEY", tasks: ["score", "tailor", "extract"], priority: 37, daily_cap: 400, enabled: true },
  { label: "sambanova-llama-8b", provider: "sambanova", base_url: "https://api.sambanova.ai/v1", model: "Meta-Llama-3.1-8B-Instruct", api_key_env: "SAMBANOVA_API_KEY", tasks: ["score", "extract"], priority: 29, daily_cap: 100, enabled: true },
  // Alibaba Cloud Model Studio (Qwen), international/Singapore endpoint. New accounts get a one-time free quota per model that expires after about 90 days;
  // after that it is pay-as-you-go unless "free quota only" is switched on in the Alibaba console. Without a DASHSCOPE_API_KEY these rows are skipped.
  { label: "alibaba-qwen-flash", provider: "alibaba", base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", model: "qwen-flash", api_key_env: "DASHSCOPE_API_KEY", tasks: ["score", "extract"], priority: 30, daily_cap: 400, enabled: true },
  { label: "alibaba-qwen-plus", provider: "alibaba", base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", api_key_env: "DASHSCOPE_API_KEY", tasks: ["score", "tailor", "extract"], priority: 32, daily_cap: 250, enabled: true },
  { label: "mistral-large", provider: "mistral", base_url: "https://api.mistral.ai/v1", model: "mistral-large-latest", api_key_env: "MISTRAL_API_KEY", tasks: ["score", "tailor", "extract"], priority: 48, daily_cap: 150, enabled: true },
  { label: "mistral-nemo", provider: "mistral", base_url: "https://api.mistral.ai/v1", model: "open-mistral-nemo", api_key_env: "MISTRAL_API_KEY", tasks: ["score", "extract"], priority: 52, daily_cap: 300, enabled: true },
  { label: "mistral-small", provider: "mistral", base_url: "https://api.mistral.ai/v1", model: "mistral-small-latest", api_key_env: "MISTRAL_API_KEY", tasks: ["score", "tailor", "extract"], priority: 50, daily_cap: 200, enabled: true },
];
