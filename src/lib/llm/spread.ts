import type { Tier } from "./tiers";

/**
 * Share work across models instead of always hitting the first one: calls that run at the same time start on different models of the
 * preferred tier (round robin), and a model that just failed is parked at the end of the order for a while so no time is wasted on it.
 * Every model stays in the chain as a fallback; only the starting point and the order change.
 */
export function spreadOrder<T extends { label: string }>(ordered: T[], o: { tierOf: (m: T) => Tier; tick: number; parked: (label: string) => boolean }): T[] {
  const healthy = ordered.filter((m) => !o.parked(m.label));
  const parked = ordered.filter((m) => o.parked(m.label));
  if (healthy.length === 0) return ordered;
  const tier = o.tierOf(healthy[0]);
  let n = 0;
  while (n < healthy.length && o.tierOf(healthy[n]) === tier) n++;
  const start = n > 0 ? o.tick % n : 0;
  return [...healthy.slice(start, n), ...healthy.slice(0, start), ...healthy.slice(n), ...parked];
}

/** A failing model is tried last for a few minutes: longer when the provider refused the key or the quota is used up. */
export function parkMillis(error: string): number {
  if (/\b(401|403)\b|unauthor|forbidden|invalid.*key|api key/i.test(error)) return 15 * 60_000;
  if (/\b429\b|rate.?limit|quota|exhaust|too many|resource.?exhausted/i.test(error)) return 5 * 60_000;
  return 60_000;
}

export class ModelParking {
  private until = new Map<string, number>();
  constructor(private now: () => number = Date.now) {}
  park(label: string, error: string) { this.until.set(label, this.now() + parkMillis(error)); }
  clear(label: string) { this.until.delete(label); }
  isParked = (label: string) => (this.until.get(label) ?? 0) > this.now();
}

export const parking = new ModelParking();
let ticks = 0;
export const nextTick = () => ticks++;

/** One entry per model and key: a model with five keys becomes five entries (labelled "name#1" to "name#5") that can run side by side. */
export function expandByKeys<M extends { label: string }>(models: M[], keysOf: (label: string) => string[] | undefined): (M & { realLabel: string; key: string | undefined })[] {
  return models.flatMap((m) => {
    const ks = keysOf(m.label) ?? [undefined];
    return ks.map((key, i) => ({ ...m, realLabel: m.label, label: ks.length > 1 ? `${m.label}#${i + 1}` : m.label, key }));
  });
}
