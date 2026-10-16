import { NextResponse } from "next/server";
import { scoreNewJobs } from "@/lib/score/run";

export const maxDuration = 60;

export async function GET(request: Request) {
  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit") ?? 15) || 15, 40);
  try {
    return NextResponse.json(await scoreNewJobs({ limit, budgetMs: 45_000 }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Scoring failed" }, { status: 422 });
  }
}
