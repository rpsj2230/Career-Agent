import { NextResponse } from "next/server";
import { MasterProfile } from "@/lib/types";
import { getProfile, saveProfile } from "@/lib/profile/store";
import { getSetting, putSetting } from "@/lib/settings";
import { logConfig } from "@/lib/activity-helpers";

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const profile = await getProfile();
  // the Languages card saves only the languages line; everything else in the preferences stays as it is
  if (body && Object.keys(body).length === 1 && typeof body.languages === "string") {
    const languages = body.languages.trim().slice(0, 500);
    await saveProfile({ ...profile, preferences: { ...profile.preferences, languages } });
    await logConfig("Languages changed", { languages });
    return NextResponse.json({ ok: true });
  }
  const parsed = MasterProfile.shape.preferences.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid preferences" }, { status: 400 });
  // a save from the Preferences form does not carry the languages line (it has its own card), so the saved one is kept
  await saveProfile({ ...profile, preferences: { ...parsed.data, languages: parsed.data.languages ?? profile.preferences.languages } });
  // roles live on the profile only; clear the older copy in Settings so the two can never disagree
  const discovery = await getSetting("discovery");
  if (discovery.roles.length > 0) await putSetting("discovery", { ...discovery, roles: [] });
  await logConfig("Profile preferences changed", { countries: parsed.data.countries, roles: parsed.data.roles });
  return NextResponse.json({ ok: true });
}
