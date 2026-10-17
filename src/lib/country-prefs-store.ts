import "server-only";
import { db } from "@/lib/db";
import { isMissingSchemaError } from "@/lib/schema";
import { CountryPrefInput, needsSponsorship, type CountryPref } from "./country-prefs";

export async function listCountryPrefs(): Promise<{ rows: CountryPref[]; missing: boolean }> {
  const res = await db().from("country_prefs").select("*").order("country");
  if (res.error) {
    if (isMissingSchemaError(res.error.message)) return { rows: [], missing: true };
    throw new Error(`load country preferences: ${res.error.message}`);
  }
  const rows = (res.data as Record<string, unknown>[]).flatMap((r) => {
    const p = CountryPrefInput.safeParse({ ...r, salary_min: r.salary_min === null ? null : Number(r.salary_min), salary_max: r.salary_max === null ? null : Number(r.salary_max) });
    return p.success ? [p.data] : []; // a row that no longer validates is skipped, not crashed on
  });
  return { rows, missing: false };
}

export async function saveCountryPref(p: CountryPref) {
  const { error } = await db().from("country_prefs").upsert({ ...p, needs_sponsorship: needsSponsorship(p.work_authorisation), updated_at: new Date().toISOString() }, { onConflict: "country" });
  if (error) throw new Error(error.message);
}

export async function deleteCountryPref(country: string) {
  const { error } = await db().from("country_prefs").delete().eq("country", country);
  if (error) throw new Error(error.message);
}

/**
 * First-time setup: every country in your profile preferences that has no entry yet gets one, filled from your profile
 * (titles, location, visa-based authorisation, expected salary). Existing entries are never touched. Each country is auto-created
 * once only (remembered), so a country you remove later does not come back; `force` (the "Fill from my profile" button) skips that memory.
 */
export async function ensureCountryDefaults(profile: import("@/lib/types").MasterProfile, force = false): Promise<string[]> {
  const { suggestCountry } = await import("./autofill/countries");
  const { rows, missing } = await listCountryPrefs();
  if (missing) return [];
  const have = new Set(rows.map((r) => r.country));
  const memo = await db().from("settings").select("value").eq("key", "autofilled_countries").maybeSingle();
  const done = new Set<string>(Array.isArray(memo.data?.value) ? (memo.data!.value as string[]) : []);
  const created: string[] = [];
  for (const c of profile.preferences.countries.map((x) => x.toLowerCase())) {
    if (have.has(c) || !/^[a-z]{2}$/.test(c) || (!force && done.has(c))) continue;
    await saveCountryPref(suggestCountry(profile, c).pref);
    created.push(c); done.add(c);
  }
  if (created.length) await db().from("settings").upsert({ key: "autofilled_countries", value: [...done], updated_at: new Date().toISOString() });
  return created;
}
