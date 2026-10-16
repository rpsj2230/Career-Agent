import { NextResponse } from "next/server";
import { generateDailyReport } from "@/lib/daily-report-store";
import { appTimezone, localDate } from "@/lib/time";

/** Morning job: store and send the report for the day that just ended (in the display time zone). */
export async function GET() {
  try {
    const r = await generateDailyReport({ date: localDate(1, appTimezone()), send: true });
    return NextResponse.json({ ok: true, date: r.report_date, delivered: r.delivered, summary: r.summary });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Report failed" }, { status: 500 });
  }
}
