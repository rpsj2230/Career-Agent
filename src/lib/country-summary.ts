import "server-only";
import { COUNTRY_NAME_MAP } from "@/lib/countries";
import { loadEffectiveCountries } from "@/lib/country-config-store";

/** Which countries are being searched right now, for the read-only lines in Settings and Profile. The Countries page is where they are chosen. */
export async function searchingCountries(): Promise<{ names: string[]; configured: boolean }> {
  try {
    const { countries, configured } = await loadEffectiveCountries();
    return { names: countries.map((c) => COUNTRY_NAME_MAP[c.country] ?? c.country.toUpperCase()), configured };
  } catch {
    return { names: [], configured: false };
  }
}
