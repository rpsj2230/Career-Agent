import { NextResponse } from "next/server";
import { MasterProfile } from "@/lib/types";
import { getProfile, saveProfile } from "@/lib/profile/store";

export async function PUT(request: Request) {
  const parsed = MasterProfile.shape.preferences.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid preferences" }, { status: 400 });
  const profile = await getProfile();
  await saveProfile({ ...profile, preferences: parsed.data });
  return NextResponse.json({ ok: true });
}
