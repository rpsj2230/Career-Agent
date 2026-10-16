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
