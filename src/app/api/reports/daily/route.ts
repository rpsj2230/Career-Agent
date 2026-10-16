import { NextResponse } from "next/server";
import { z } from "zod";
import { validDate } from "@/lib/daily-report";
import { generateDailyReport } from "@/lib/daily-report-store";
import { isMissingSchemaError } from "@/lib/schema";

const Body = z.object({ date: z.string().optional(), send: z.boolean().optional() });

/** Generate (or regenerate) the report for a day; the default is today in the display time zone. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || (parsed.data.date && !validDate(parsed.data.date))) return NextResponse.json({ error: "date must be a real day as YYYY-MM-DD" }, { status: 400 });
  try {
    const r = await generateDailyReport({ date: parsed.data.date, send: parsed.data.send });
    return NextResponse.json({ ok: true, date: r.report_date, summary: r.summary, delivered: r.delivered });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: isMissingSchemaError(msg) ? "The database update has not been applied yet. Open System to apply it." : msg }, { status: isMissingSchemaError(msg) ? 409 : 500 });
  }
}
