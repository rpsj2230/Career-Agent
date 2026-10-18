import { NextResponse } from "next/server";
import { failStaleRuns } from "@/lib/activity";
import { checkAssistant } from "@/lib/apply/assistant-health";
import { checkStaleSources } from "@/lib/integrations/health-check";
import { isDue } from "@/lib/schedule";
import { healKeys } from "@/lib/llm/keys";
import { listSchedules, seedRecommendedSchedule } from "@/lib/schedule-store";
import { recordTick } from "@/lib/automation-health";
import { deliverDaily } from "@/lib/daily-delivery";

/**
 * The hourly GitHub Actions tick asks this first, so the heavy job (install, models, browser) only starts when a
 * schedule is actually due. Read-only for schedules: the pipeline itself claims them. Also clears runs that died.
 */
export async function GET() {
  const swept = await failStaleRuns(30);
  const stale = await checkStaleSources();
  const assistantAlerted = await checkAssistant();
  const listed = await listSchedules();
  const { missing } = listed;
  const seeded = missing ? null : await seedRecommendedSchedule(listed.rows.length).catch(() => null);
  const rows = seeded ? [...listed.rows, seeded] : listed.rows;
  const now = new Date();
  const due = rows.filter((s) => isDue(s, now));
  await recordTick({ due: due.length, total: rows.length });
  const delivered = await deliverDaily().catch((e) => ({ sent: false, skipped: e instanceof Error ? e.message : String(e) })); // the morning report and health check, once a day
  const healed = await healKeys().catch(() => 0); // give saved model keys the copy the GitHub runner can read
  return NextResponse.json({ daily: delivered, healedKeys: healed, due: due.length, schedules: due.map((s) => s.name), total: rows.length, missing, seeded: !!seeded, swept, staleSources: stale.length, assistantAlerted });
}
