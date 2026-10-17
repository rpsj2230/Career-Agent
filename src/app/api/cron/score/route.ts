import { NextResponse } from "next/server";
import { scoreNewJobs } from "@/lib/score/run";
import { hasActiveSchedules } from "@/lib/schedule-store";
import { within } from "@/lib/time-limit";

export const maxDuration = 60;

/** Scoring gets 45 s (no model call starts that cannot finish inside it), and a reply always goes out by 55 s. */
export async function GET(request: Request) {
  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit") ?? 15) || 15, 40);
  const work = (async (): Promise<Response> => {
    try {
      const trigger = request.headers.get("authorization")?.startsWith("Bearer ") ? "schedule" : "manual";
      if (trigger === "schedule" && (await hasActiveSchedules())) return NextResponse.json({ skipped: "Your schedules (Schedules page) handle scoring now." });
      return NextResponse.json(await scoreNewJobs({ limit, budgetMs: 45_000, trigger }));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Scoring failed" }, { status: 422 });
    }
  })();
  return within(work, 55_000, () => NextResponse.json({ partial: true, note: "Stopped at the time limit for a web request. Jobs scored so far are saved; press the button again to score the rest." }));
}
