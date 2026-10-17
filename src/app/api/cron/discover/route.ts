import { NextResponse } from "next/server";
import { discoverNow } from "@/lib/jobs/discover";
import { scoreNewJobs } from "@/lib/score/run";
import { hasActiveSchedules } from "@/lib/schedule-store";
import { within } from "@/lib/time-limit";

export const maxDuration = 60;

/** The host cuts a request off at 60 s: discovery gets 30 s, scoring what is left up to 50 s in all, and a reply always goes out by 55 s. */
const DISCOVERY_MS = 30_000;
const TOTAL_MS = 50_000;
const REPLY_BY_MS = 55_000;

/**
 * Called by schedules (bearer token) and by the "Find jobs now" button (signed-in session).
 * Discovery runs inside a recorded run; scoring then uses the time that is left. Hosted scrapers (minutes per run) are not
 * run from here; the scheduled GitHub run does them.
 */
export async function GET(request: Request) {
  const trigger = request.headers.get("authorization")?.startsWith("Bearer ") ? "schedule" : "manual";
  if (trigger === "schedule" && (await hasActiveSchedules())) return NextResponse.json({ skipped: "Your schedules (Schedules page) handle searching now." });
  const t0 = Date.now();
  const work = (async (): Promise<Response> => {
    try {
      const res = await discoverNow({ trigger, budgetMs: DISCOVERY_MS, interactive: true });
      const roomLeft = TOTAL_MS - (Date.now() - t0);
      // scoring starts only when a model call can still finish; otherwise the new jobs wait for "Score new jobs"
      const scoring = roomLeft >= 15_000
        ? await scoreNewJobs({ limit: 10, budgetMs: roomLeft, trigger }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }))
        : { skipped: "No time left in this request to score; press Score new jobs." };
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
  })();
  return within(work, REPLY_BY_MS, () => NextResponse.json({ partial: true, note: "Stopped at the time limit for a web request. Everything found so far is saved; press the button again to continue, or let the scheduled run finish the rest." }));
}
