export type ReportRow = {
  country: string | null; source: string; apply_type: string; status: string; lifecycle: string;
  submitted_at: string | null; score: number | null; gaps: string[];
};

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const top = (m: Map<string, number>, n = 8) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export type Summary = ReturnType<typeof summarize>;

/**
 * Aggregate applications for the reports page.
 * "Responded" = lifecycle interview or offer; rejections are counted separately, so response rate is not inflated.
 */
export function summarize(rows: ReportRow[], since?: Date) {
  const inWindow = since ? rows.filter((r) => r.submitted_at && new Date(r.submitted_at) >= since) : rows;
  const submitted = inWindow.filter((r) => r.status === "submitted");
  const byCountry = new Map<string, number>(), bySource = new Map<string, number>(), byType = new Map<string, number>(), gaps = new Map<string, number>();
  for (const r of submitted) {
    bump(byCountry, (r.country ?? "unknown").toUpperCase());
    bump(bySource, r.source.split(":")[0]);
    bump(byType, r.apply_type);
  }
  for (const r of inWindow) for (const g of r.gaps) bump(gaps, g.toLowerCase().trim());
  const responded = submitted.filter((r) => r.lifecycle === "interview" || r.lifecycle === "offer");
  const rejected = submitted.filter((r) => r.lifecycle === "rejected");
  const scoreOf = (xs: ReportRow[]) => avg(xs.map((r) => r.score).filter((s): s is number => s !== null));
  return {
    submitted: submitted.length,
    responded: responded.length,
    rejected: rejected.length,
    responseRate: submitted.length ? Math.round((responded.length / submitted.length) * 100) : null,
    avgFitSubmitted: scoreOf(submitted),
    avgFitResponded: scoreOf(responded),
    failed: inWindow.filter((r) => r.status === "failed").length,
    byCountry: top(byCountry), bySource: top(bySource), byType: top(byType), commonGaps: top(gaps),
  };
}

export function digestText(c: { fresh: number; queued: number; prepared: number; sent7: number; failed: number }, appUrl?: string): string {
  return [
    "Career Agent daily digest",
    `New jobs awaiting scoring: ${c.fresh}`,
    `Matched and waiting for your review: ${c.queued}`,
    `Prepared, waiting for approval: ${c.prepared}`,
    `Applications sent in the last 7 days: ${c.sent7}`,
    c.failed ? `Needs attention (failed or needs input): ${c.failed}` : "Nothing needs attention",
    appUrl ? `Open: ${appUrl}/jobs` : "",
  ].filter(Boolean).join("\n");
}
