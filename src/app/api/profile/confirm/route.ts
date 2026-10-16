import { NextResponse } from "next/server";
import { MasterProfile } from "@/lib/types";
import { clearDraft, saveProfile } from "@/lib/profile/store";

/** The reviewed (and possibly edited) profile becomes the single source of truth. */
export async function POST(request: Request) {
  const parsed = MasterProfile.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid profile", issues: parsed.error.issues }, { status: 400 });
  await saveProfile(parsed.data);
  await clearDraft();
  return NextResponse.json({ ok: true });
}
