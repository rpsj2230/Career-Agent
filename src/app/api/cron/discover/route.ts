import { NextResponse } from "next/server";
import { discoverNow } from "@/lib/jobs/discover";
import { scoreNewJobs } from "@/lib/score/run";

export const maxDuration = 60;

/**
 * Called by schedules (bearer token) and by the "Find jobs now" button (signed-in session).
 * Discovery runs inside a recorded run; scoring then uses the time that is left.
 */
export async function GET(request: Request) {
  const trigger = request.headers.get("authorization")?.startsWith("Bearer ") ? "schedule" : "manual";
  try {
    const res = await discoverNow({ trigger, budgetMs: 35_000 });
    const scoring = await scoreNewJobs({ limit: 10, budgetMs: 15_000, trigger }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    const scans = res.outcomes;
    return NextResponse.json({
      scans: scans.length,
      fetched: scans.reduce((n, s) => n + s.counts.fetched, 0),
      inserted: scans.reduce((n, s) => n + s.counts.inserted, 0),
      duplicates: scans.reduce((n, s) => n + s.counts.duplicates, 0),
      skippedScans: res.skipped,
      sourceErrors: scans.filter((s) => !s.ok).map((s) => ({ source: `${s.integration}${s.query ? `:${s.query}` : ""}`, error: s.error })),
      scoring,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Discovery failed" }, { status: 422 });
  }
}
