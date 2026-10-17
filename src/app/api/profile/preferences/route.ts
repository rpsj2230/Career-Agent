import { NextResponse } from "next/server";
import { MasterProfile } from "@/lib/types";
import { getProfile, saveProfile } from "@/lib/profile/store";
import { getSetting, putSetting } from "@/lib/settings";
import { logConfig } from "@/lib/activity-helpers";

export async function PUT(request: Request) {
  const parsed = MasterProfile.shape.preferences.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid preferences" }, { status: 400 });
  const profile = await getProfile();
  await saveProfile({ ...profile, preferences: parsed.data });
  // roles live on the profile only; clear the older copy in Settings so the two can never disagree
  const discovery = await getSetting("discovery");
  if (discovery.roles.length > 0) await putSetting("discovery", { ...discovery, roles: [] });
  await logConfig("Profile preferences changed", { countries: parsed.data.countries, roles: parsed.data.roles });
  return NextResponse.json({ ok: true });
}
