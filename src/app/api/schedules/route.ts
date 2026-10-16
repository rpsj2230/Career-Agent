import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { ScheduleInput } from "@/lib/schedule";
import { createSchedule } from "@/lib/schedule-store";
import { isMissingSchemaError } from "@/lib/schema";
import { scheduleSummary } from "@/lib/schedule-log";

export async function POST(request: Request) {
  const parsed = ScheduleInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
  try {
    const s = await createSchedule(parsed.data);
    await logActivity({ kind: "schedule.changed", message: `Schedule created: ${s.name}`, detail: scheduleSummary(s) });
    return NextResponse.json({ ok: true, id: s.id, next_run_at: s.next_run_at });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: isMissingSchemaError(msg) ? "The database update has not been applied yet. Open System to apply it." : `Could not save: ${msg}` }, { status: isMissingSchemaError(msg) ? 409 : 500 });
  }
}
