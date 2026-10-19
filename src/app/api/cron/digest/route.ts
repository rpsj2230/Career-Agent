import { NextResponse } from "next/server";
import { generateDailyReport } from "@/lib/daily-report-store";
import { forEachProfile } from "@/lib/profiles-store";
import { appTimezone, localDate } from "@/lib/time";

/** Morning job: store and send the report for the day that just ended (in the display time zone). */
export async function GET() {
  // one report for each profile that is switched on
  const per = await forEachProfile((p) => generateDailyReport({ date: localDate(1, appTimezone()), send: true }).then((r) => ({ profile: p?.name ?? null, date: r.report_date, delivered: r.delivered, summary: r.summary })));
  const failed = per.filter((r) => r.error);
  if (failed.length && failed.length === per.length) return NextResponse.json({ error: failed[0].error instanceof Error ? failed[0].error.message : "Report failed" }, { status: 500 });
  const ok = per.flatMap((r) => (r.result ? [r.result] : []));
  return NextResponse.json({ ok: true, date: ok[0]?.date, delivered: ok.every((r) => r.delivered), summary: ok[0]?.summary, reports: ok });
}
