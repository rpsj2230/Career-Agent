import type { Task } from "@/lib/types";
import type { ModelRow } from "./fallback";

/**
 * Two tiers of model. Scoring is a classification the rules already bound, so a fast model is enough and saves the stronger
 * models' daily quota; writing a resume or cover letter is where quality shows, so those go to the stronger models first.
 * Every model stays in the chain as a fallback, whatever the order.
 */
export type Tier = "fast" | "strong";

const FAST = /(lite|mini|small|instant|8b|flash|haiku|nano|3b|7b)/i;

/** A model's tier: your override by label if you set one, otherwise guessed from its name. */
export const tierOf = (m: Pick<ModelRow, "label" | "model">, overrides: Record<string, Tier> = {}): Tier => overrides[m.label] ?? (FAST.test(`${m.label} ${m.model}`) ? "fast" : "strong");

export const defaultPrefer = (task: Task): Tier => (task === "tailor" ? "strong" : "fast");

/** Models of the preferred tier first; within a tier, your priority order is kept. */
export function orderForTier<T extends Pick<ModelRow, "label" | "model" | "priority">>(candidates: T[], prefer: Tier, overrides: Record<string, Tier> = {}): T[] {
  const rank = (m: T) => (tierOf(m, overrides) === prefer ? 0 : 1);
  return [...candidates].sort((a, b) => rank(a) - rank(b) || a.priority - b.priority);
}
