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
