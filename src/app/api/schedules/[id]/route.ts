import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { ScheduleInput } from "@/lib/schedule";
import { scheduleSummary } from "@/lib/schedule-log";
import { deleteSchedule, getSchedule, setPaused, updateSchedule } from "@/lib/schedule-store";

const idOk = (id: string) => z.uuid().safeParse(id).success;
type Ctx = { params: Promise<{ id: string }> };

/** Edit a schedule. */
export async function PUT(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!idOk(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = ScheduleInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
  const s = await updateSchedule(id, parsed.data);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logActivity({ kind: "schedule.changed", message: `Schedule edited: ${s.name}`, detail: scheduleSummary(s) });
  return NextResponse.json({ ok: true, next_run_at: s.next_run_at });
}

/** Pause or resume without losing the schedule's settings. */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!idOk(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = z.object({ paused: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Send { paused: true | false }" }, { status: 400 });
  const s = await setPaused(id, body.data.paused);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logActivity({ kind: "schedule.changed", message: `Schedule ${s.paused ? "paused" : "resumed"}: ${s.name}`, detail: scheduleSummary(s) });
  return NextResponse.json({ ok: true, paused: s.paused, next_run_at: s.next_run_at });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!idOk(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const s = await getSchedule(id);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await deleteSchedule(id);
  await logActivity({ kind: "schedule.changed", message: `Schedule deleted: ${s.name}`, detail: scheduleSummary(s) });
  return NextResponse.json({ ok: true });
}
