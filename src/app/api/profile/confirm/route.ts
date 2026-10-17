import { NextResponse } from "next/server";
import { MasterProfile } from "@/lib/types";
import { clearDraft, saveProfile } from "@/lib/profile/store";
import { duplicateId } from "@/lib/profile/skills";
import { fillPreferences } from "@/lib/autofill/preferences";
import { ensureCountryDefaults } from "@/lib/country-prefs-store";
import { logConfig } from "@/lib/activity-helpers";

/** The reviewed (and possibly edited) profile becomes the single source of truth. */
export async function POST(request: Request) {
  const parsed = MasterProfile.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid profile", issues: parsed.error.issues }, { status: 400 });
  const clash = duplicateId(parsed.data);
  if (clash) return NextResponse.json({ error: `The id "${clash}" is used twice. Every item needs its own unique id.` }, { status: 400 });
  await saveProfile(parsed.data);
  await logConfig("Profile confirmed as the source of truth", { experience: parsed.data.experience.length, skills: parsed.data.skills.length, education: parsed.data.education.length });
  await clearDraft();
  // first-time defaults from what was just confirmed: empty preferences, then an entry for each of your countries
  try {
    const { preferences, filled } = fillPreferences(parsed.data);
    const profile = filled.length ? { ...parsed.data, preferences } : parsed.data;
    if (filled.length) await saveProfile(profile);
    const created = await ensureCountryDefaults(profile);
    if (filled.length || created.length) await logConfig("Preferences and countries filled in from your profile", { filled, countries: created });
  } catch (e) { console.error(`[autofill] ${e instanceof Error ? e.message : e}`); }
  return NextResponse.json({ ok: true });
}
