import { NextResponse } from "next/server";
import { scoreNewJobs } from "@/lib/score/run";
import { activeProfiles, forEachProfile } from "@/lib/profiles-store";
import { hasActiveSchedules } from "@/lib/schedule-store";
import { within } from "@/lib/time-limit";

export const maxDuration = 60;

/** Scoring gets 45 s (no model call starts that cannot finish inside it), and a reply always goes out by 55 s. */
export async function GET(request: Request) {
  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit") ?? 15) || 15, 40);
  const work = (async (): Promise<Response> => {
    try {
      const trigger = request.headers.get("authorization")?.startsWith("Bearer ") ? "schedule" : "manual";
      if (trigger === "schedule") {
        // a scheduled call has no signed-in person: it serves each profile that has no schedule of its own
        const per = await forEachProfile(async (p) => (await hasActiveSchedules()) ? { profile: p?.name ?? null, skipped: "Your schedules (Schedules page) handle scoring now." } : { profile: p?.name ?? null, ...(await scoreNewJobs({ limit, budgetMs: Math.floor(45_000 / Math.max(1, (await activeProfiles()).length)), trigger })) });
        return NextResponse.json(per.length === 1 ? (per[0].result ?? { error: String(per[0].error) }) : { profiles: per.map((r) => r.result ?? { error: String(r.error) }) });
      }
      return NextResponse.json(await scoreNewJobs({ limit, budgetMs: 45_000, trigger }));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Scoring failed" }, { status: 422 });
    }
  })();
  return within(work, 55_000, () => NextResponse.json({ partial: true, note: "Stopped at the time limit for a web request. Jobs scored so far are saved; press the button again to score the rest." }));
}
