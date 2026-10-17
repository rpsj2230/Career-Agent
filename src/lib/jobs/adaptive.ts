import { titleFamily } from "@/lib/tailor/similarity";
import { titleMatches } from "./sources";

/**
 * A search that keeps finding nothing new is asked less often: the minimum gap doubles after every three empty runs, up to
 * a day. Nothing is missed (the next run still asks for everything since the last one); it only stops spending requests,
 * and free-plan quota, on searches that are not paying off.
 */
export function effectiveIntervalHours(minHours: number, idleRuns: number): number {
  if (minHours <= 0) return 0;
  const doubled = minHours * 2 ** Math.floor(idleRuns / 3);
  return Math.max(minHours, Math.min(doubled, 24));
}

/** Leading empty runs (newest first): scans that stored no new job. */
export const idleStreak = (history: { inserted: number }[]): number => {
  let n = 0;
  for (const h of history) { if (h.inserted > 0) break; n++; }
  return n;
};

/**
 * Titles that produced your matches but that you do not search for: "Product Owner" showing up in matches for "Product Manager".
 * A title needs at least `minCount` matches to be suggested, and anything an existing title already finds is left out.
 */
export function suggestTitles(configured: string[], matchedTitles: string[], minCount = 2, max = 5): { title: string; count: number }[] {
  const groups = new Map<string, { n: number; spellings: Map<string, number> }>();
  for (const raw of matchedTitles) {
    const title = raw.replace(/\s*[\(\[|,–-].*$/, "").replace(/\s+/g, " ").trim();
    if (title.length < 3 || title.length > 60 || titleMatches(title, configured)) continue;
    const key = titleFamily(title).join(" ");
    if (!key) continue;
    const g = groups.get(key) ?? { n: 0, spellings: new Map() };
    g.n++; g.spellings.set(title, (g.spellings.get(title) ?? 0) + 1);
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.n >= minCount).sort((a, b) => b.n - a.n)
    .slice(0, max).map((g) => ({ title: [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0], count: g.n }));
}

export type RunQuery = { key: string; fetched: number };
/**
 * A source that suddenly returns nothing for searches that always returned something has probably changed, even though it did not
 * report an error. Flags it when at least half of its searches (and at least two) are empty now but each had results in each
 * of the last `need` runs.
 */
export function silentDrop(current: RunQuery[], history: Map<string, { fetched: number }[]>, need = 3): boolean {
  if (current.length < 2) return false;
  const dropped = current.filter((q) => q.fetched === 0 && (history.get(q.key) ?? []).length >= need && (history.get(q.key) ?? []).slice(0, need).every((h) => h.fetched > 0));
  return dropped.length >= 2 && dropped.length * 2 >= current.length;
}
