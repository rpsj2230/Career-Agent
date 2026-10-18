/**
 * A plain three-way grouping of models for the Models page: strong (best for writing resumes and cover letters),
 * medium (good all-rounders) and small (fast and light; fine for scoring and simple extraction).
 * It is a guide read from the model's name; the order in which models are tried is still set by priority and tier.
 */
export type ModelClass = "strong" | "medium" | "small";

export function modelClass(m: { label?: string; model: string }): ModelClass {
  const name = `${m.model}`.toLowerCase();
  if (/scout/.test(name)) return "medium"; // 17B active parameters but a much larger model overall
  if (/(405b|120b|70b|large|\bpro\b|plus|kimi|opus|sonnet|ultra|maverick|command-r-plus)/.test(name)) return "strong";
  if (/(lite|(^|[-/ ])mini($|[-_ ])|nano|instant|\b[1-9]b\b|\b1[0-9]b\b|mistral-nemo|ministral)/.test(name)) return "small";
  return "medium";
}

export const CLASS_INFO: Record<ModelClass, { title: string; blurb: string }> = {
  strong: { title: "Strong models", blurb: "Largest and best quality. Used first for writing resumes and cover letters." },
  medium: { title: "Medium models", blurb: "Good all-rounders. Used for writing when the strong ones are busy, and for scoring." },
  small: { title: "Small models", blurb: "Fast and light, with the most generous limits. Used for scoring and simple extraction." },
};

const PROVIDER_NAMES: Record<string, string> = {
  google: "Google Gemini", groq: "Groq", mistral: "Mistral", nvidia: "NVIDIA", cerebras: "Cerebras", sambanova: "SambaNova", github: "GitHub Models",
  alibaba: "Alibaba Qwen", zai: "Z.ai GLM", siliconflow: "SiliconFlow", cohere: "Cohere", openrouter: "OpenRouter", ollama: "Local model", anthropic: "Anthropic Claude",
};
export const providerName = (provider: string): string => PROVIDER_NAMES[provider.toLowerCase()] ?? (provider ? provider[0].toUpperCase() + provider.slice(1) : "Other");

/** Group rows by provider: providers with something ready first, then the rest, each alphabetical. */
export function groupByProvider<T extends { provider: string; priority: number }>(rows: T[], ready: (r: T) => boolean): { provider: string; name: string; rows: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of rows) { const k = r.provider.toLowerCase(); map.set(k, [...(map.get(k) ?? []), r]); }
  return [...map.entries()]
    .map(([provider, list]) => ({ provider, name: providerName(provider), rows: [...list].sort((a, b) => a.priority - b.priority) }))
    .sort((a, b) => Number(b.rows.some(ready)) - Number(a.rows.some(ready)) || a.name.localeCompare(b.name));
}
