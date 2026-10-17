import { titleFamily } from "@/lib/tailor/similarity";

/**
 * Your own decisions teach the agent what you want. Interviews and offers count for a role type or company; rejections and the jobs
 * you skipped by hand count against it. The effect is small and bounded (never more than 8 points), needs several examples before it
 * moves at all, and is shown on every score it changes, so it nudges the ranking without ever overriding the evidence.
 */
export type Outcome = { title: string; company: string; kind: "positive" | "negative" };
export type OutcomeStats = Map<string, { pos: number; neg: number }>;

const MIN_EXAMPLES = 3;
const MAX_BIAS = 8;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(pvt|private|ltd|limited|inc|llc|corp|co|pte)\b/g, "").replace(/\s+/g, " ").trim();
export const keysOf = (j: { title: string; company: string }): string[] => {
  const fam = titleFamily(j.title).join(" ");
  return [fam ? `title:${fam}` : "", norm(j.company) ? `company:${norm(j.company)}` : ""].filter(Boolean);
};

export function buildStats(outcomes: Outcome[]): OutcomeStats {
  const stats: OutcomeStats = new Map();
  for (const o of outcomes) for (const k of keysOf(o)) {
    const cur = stats.get(k) ?? { pos: 0, neg: 0 };
    if (o.kind === "positive") cur.pos++; else cur.neg++;
    stats.set(k, cur);
  }
  return stats;
}

/** Points to add to (or take from) a score for this job, from what happened to similar jobs before. 0 until there is enough evidence. */
export function outcomeBias(job: { title: string; company: string }, stats: OutcomeStats): { bias: number; why: string[] } {
  let total = 0;
  const why: string[] = [];
  for (const k of keysOf(job)) {
    const s = stats.get(k);
    if (!s || s.pos + s.neg < MIN_EXAMPLES) continue;
    const n = s.pos + s.neg;
    const signal = (s.pos - 0.7 * s.neg) / (n + 2); // shrinks toward 0 for small samples
    const points = Math.round(signal * (k.startsWith("company:") ? 6 : 8));
    if (points === 0) continue;
    total += points;
    why.push(`${k.startsWith("company:") ? "company" : "role type"} history (${s.pos} good, ${s.neg} not): ${points > 0 ? "+" : ""}${points}`);
  }
  return { bias: Math.max(-MAX_BIAS, Math.min(MAX_BIAS, total)), why };
}
