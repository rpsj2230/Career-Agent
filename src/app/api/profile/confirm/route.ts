import { NextResponse } from "next/server";
import { MasterProfile } from "@/lib/types";
import { clearDraft, saveProfile } from "@/lib/profile/store";
import { logConfig } from "@/lib/activity-helpers";

/** The reviewed (and possibly edited) profile becomes the single source of truth. */
export async function POST(request: Request) {
  const parsed = MasterProfile.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid profile", issues: parsed.error.issues }, { status: 400 });
  await saveProfile(parsed.data);
  await logConfig("Profile confirmed as the source of truth", { experience: parsed.data.experience.length, skills: parsed.data.skills.length, education: parsed.data.education.length });
  await clearDraft();
  return NextResponse.json({ ok: true });
}
