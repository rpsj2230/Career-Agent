/** How each job source is performing over the last weeks, and a plain verdict with advice (pure, so it is testable). */
export type SourceStats = { id: string; name: string; scans: number; failedScans: number; fetched: number; inserted: number; matched: number; spanDays: number };
export type SourceVerdict = { tone: "good" | "ok" | "bad" | "early"; headline: string; advice: string; reliable: boolean };

/** A verdict needs about a month of runs; before that the numbers are labelled early. */
export const RELIABLE_DAYS = 28;

export function sourceVerdict(s: SourceStats): SourceVerdict {
  const reliable = s.spanDays >= RELIABLE_DAYS && s.scans >= 10;
  const early = reliable ? "" : " (early numbers: a reliable verdict needs about a month of runs)";
  if (s.scans === 0) return { tone: "early", headline: "Not searched", advice: "No searches in this period. Connect it, or check that your schedule includes it.", reliable: false };
  if (s.failedScans / s.scans >= 0.5) return { tone: "bad", headline: "Mostly failing", advice: `${s.failedScans} of ${s.scans} searches failed. Fix its key or login on the Job sources page, or switch it off so it stops wasting time.${early}`, reliable };
  if (s.fetched === 0) return { tone: reliable ? "bad" : "early", headline: "Returns nothing for you", advice: `It answered ${s.scans} times but never returned a posting for your roles and countries.${reliable ? " Consider switching it off, or adding the countries and titles it covers." : early}`, reliable };
  const fitRate = s.inserted > 0 ? s.matched / s.inserted : 0;
  if (s.matched >= 3 && fitRate >= 0.05) return { tone: "good", headline: "Productive", advice: `${s.inserted} new jobs, ${s.matched} of them good matches (${Math.round(fitRate * 100)}%). Keep it.${early}`, reliable };
  if (s.inserted === 0) return { tone: reliable ? "bad" : "early", headline: "Nothing new", advice: `It read ${s.fetched} postings but none were new. Another source is probably finding the same jobs first.${reliable ? " It adds little: consider switching it off." : early}`, reliable };
  if (s.inserted >= 20 && fitRate < 0.03) return { tone: reliable ? "bad" : "early", headline: "Many jobs, few fits", advice: `${s.inserted} new jobs but only ${s.matched} matched you. Narrow its titles or countries, or switch it off to save scoring effort.${early}`, reliable };
  return { tone: "ok", headline: "Some yield", advice: `${s.inserted} new jobs, ${s.matched} good match${s.matched === 1 ? "" : "es"} so far.${early}`, reliable };
}

export function summarizeScans(scans: { integration: string; status: string; fetched: number; inserted: number; started_at: string }[], jobs: { source: string | null; status: string }[], names: Record<string, string>, now = new Date()): SourceStats[] {
  const MATCHED = new Set(["queued", "prepared", "saved", "applied"]);
  const ids = new Set<string>([...scans.map((s) => s.integration), ...jobs.map((j) => (j.source ?? "").split(":")[0]).filter(Boolean)]);
  return [...ids].map((id) => {
    const mine = scans.filter((s) => s.integration === id);
    const first = mine.reduce((m, s) => Math.min(m, new Date(s.started_at).getTime()), Infinity);
    return {
      id, name: names[id] ?? id, scans: mine.length, failedScans: mine.filter((s) => s.status === "error").length,
      fetched: mine.reduce((n, s) => n + (s.fetched ?? 0), 0), inserted: mine.reduce((n, s) => n + (s.inserted ?? 0), 0),
      matched: jobs.filter((j) => (j.source ?? "").split(":")[0] === id && MATCHED.has(j.status)).length,
      spanDays: Number.isFinite(first) ? Math.floor((now.getTime() - first) / 86_400_000) : 0,
    };
  }).sort((a, b) => b.matched - a.matched || b.inserted - a.inserted);
}
