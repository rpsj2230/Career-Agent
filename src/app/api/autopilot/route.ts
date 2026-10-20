import { NextResponse } from "next/server";
import { z } from "zod";
import { AUTOPILOT } from "@/lib/autopilot";
import { setAutopilot } from "@/lib/autopilot-store";

const Body = z.object({ enabled: z.boolean() });

/** The Autopilot switch: sets every setting and limit needed to run without a person approving (or puts schedules back to asking). */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { enabled: true } or { enabled: false }" }, { status: 400 });
  const r = await setAutopilot(parsed.data.enabled);
  const c = AUTOPILOT.caps;
  return NextResponse.json({
    ok: true,
    note: parsed.data.enabled
      ? `Autopilot is on. Up to ${c.daily_total} applications a day (LinkedIn ${c.daily_linkedin} a day, ${c.weekly_linkedin} a week), ${r.schedules} schedule${r.schedules === 1 ? "" : "s"} set to search every ${AUTOPILOT.schedule.interval_hours} hours and apply without asking. Make sure the assistant on your computer is running (npm run assist:check).`
      : "Autopilot is off: schedules ask for your approval again. Limits were left as they are.",
  });
}
