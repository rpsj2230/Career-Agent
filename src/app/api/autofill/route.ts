import { NextResponse } from "next/server";
import { z } from "zod";
import { logConfig } from "@/lib/activity-helpers";
import { fillEmpty, suggestCountry } from "@/lib/autofill/countries";
import { fillPreferences } from "@/lib/autofill/preferences";
import { COUNTRY_NAME_MAP } from "@/lib/countries";
import { ensureCountryDefaults, listCountryPrefs, saveCountryPref } from "@/lib/country-prefs-store";
import { getProfile, saveProfile } from "@/lib/profile/store";

const Body = z.object({ scope: z.enum(["country", "countries", "preferences"]), country: z.string().regex(/^[a-z]{2}$/).optional() });

/**
 * "Fill from my profile". Only EMPTY fields are filled, so pressing it never overwrites anything you set.
 * country: one country's empty fields; countries: every country in your preferences (creating missing entries);
 * preferences: empty profile preferences (roles, countries, pay country) from the rest of the profile.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const profile = await getProfile();
  if (profile.experience.length === 0) return NextResponse.json({ error: "Import and confirm your profile first" }, { status: 409 });

  if (parsed.data.scope === "preferences") {
    const { preferences, filled } = fillPreferences(profile);
    if (filled.length) { await saveProfile({ ...profile, preferences }); await logConfig("Profile preferences filled from your profile", { filled }); }
    return NextResponse.json({ ok: true, filled, note: filled.length ? `Filled: ${filled.join(", ")}` : "Nothing was empty" });
  }

  if (parsed.data.scope === "countries") {
    const created = await ensureCountryDefaults(profile, true);
    const { rows } = await listCountryPrefs();
    const touched: string[] = [];
    for (const r of rows) {
      const { pref, changed } = fillEmpty(r, suggestCountry(profile, r.country));
      if (changed.length) { await saveCountryPref(pref); touched.push(r.country); }
    }
    await logConfig("Countries filled from your profile", { created, filled: touched });
    return NextResponse.json({ ok: true, created, filled: touched, note: created.length + touched.length ? "Countries filled from your profile" : "Nothing was empty" });
  }

  const country = parsed.data.country;
  if (!country) return NextResponse.json({ error: "country required" }, { status: 400 });
  const { rows } = await listCountryPrefs();
  const existing = rows.find((r) => r.country === country);
  const s = suggestCountry(profile, country);
  const { pref, changed } = existing ? fillEmpty(existing, s) : { pref: s.pref, changed: s.filled };
  if (changed.length) { await saveCountryPref(pref); await logConfig(`Country filled from your profile: ${COUNTRY_NAME_MAP[country] ?? country}`, { country, filled: changed }); }
  return NextResponse.json({ ok: true, filled: changed, note: changed.length ? `Filled: ${changed.join(", ")}` : "Nothing was empty to fill" });
}
