import { NextResponse } from "next/server";
import { failStaleRuns } from "@/lib/activity";
import { isDue } from "@/lib/schedule";
import { listSchedules } from "@/lib/schedule-store";

/**
 * The hourly GitHub Actions tick asks this first, so the heavy job (install, models, browser) only starts when a
 * schedule is actually due. Read-only for schedules: the pipeline itself claims them. Also clears runs that died.
 */
export async function GET() {
  const swept = await failStaleRuns(30);
  const { rows, missing } = await listSchedules();
  const now = new Date();
  const due = rows.filter((s) => isDue(s, now));
  return NextResponse.json({ due: due.length, schedules: due.map((s) => s.name), total: rows.length, missing, swept });
}
