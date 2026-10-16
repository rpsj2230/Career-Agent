import "server-only";
import { getProfile } from "@/lib/profile/store";
import { getSetting } from "@/lib/settings";
import { dedupeList } from "./country-prefs";
import { mergeCountryConfigs, type EffectiveCountry } from "./country-config";
import { listCountryPrefs } from "./country-prefs-store";

/** Loads the effective per-country configuration. A missing table just means "use the general settings". */
export async function loadEffectiveCountries(): Promise<{ countries: EffectiveCountry[]; configured: boolean; globalRoles: string[] }> {
  const [{ rows }, discovery, profile] = await Promise.all([listCountryPrefs(), getSetting("discovery"), getProfile()]);
  const globalRoles = dedupeList([...discovery.roles, ...profile.preferences.roles]);
  const fallbackCountries = discovery.countries.length ? discovery.countries : profile.preferences.countries;
  return { countries: mergeCountryConfigs(rows, globalRoles, fallbackCountries), configured: rows.length > 0, globalRoles };
}
