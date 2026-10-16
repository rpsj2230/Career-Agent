import { NextResponse } from "next/server";
import { scoreNewJobs } from "@/lib/score/run";
import { hasActiveSchedules } from "@/lib/schedule-store";

export const maxDuration = 60;

export async function GET(request: Request) {
  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit") ?? 15) || 15, 40);
  try {
    const trigger = request.headers.get("authorization")?.startsWith("Bearer ") ? "schedule" : "manual";
    if (trigger === "schedule" && (await hasActiveSchedules())) return NextResponse.json({ skipped: "Your schedules (Schedules page) handle scoring now." });
    return NextResponse.json(await scoreNewJobs({ limit, budgetMs: 45_000, trigger }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Scoring failed" }, { status: 422 });
  }
}
