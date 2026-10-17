import { dedupeList } from "@/lib/country-prefs";
import type { MasterProfile } from "@/lib/types";
import { countryOfLocation } from "./countries";

type Prefs = MasterProfile["preferences"];

/** Job titles from your recent roles: "Senior Project Manager | Business Analyst, Enterprise Team" gives two titles. */
export function rolesFromExperience(p: MasterProfile): string[] {
  const parts = p.experience.slice(0, 3).flatMap((e) => e.title.split(/[|/·•]/)).map((t) => t.split(",")[0].trim()).filter((t) => t.length > 2 && t.length < 50);
  return dedupeList(parts).slice(0, 5);
}

/**
 * First-time defaults for the profile's preferences, from the rest of the profile. Only empty fields are filled; what you have
 * already set is never changed. Returns the preferences and the names of the fields that were filled.
 */
export function fillPreferences(p: MasterProfile): { preferences: Prefs; filled: string[] } {
  const pr = { ...p.preferences };
  const filled: string[] = [];
  const home = countryOfLocation(p.basics.location);
  if (pr.roles.length === 0) { const r = rolesFromExperience(p); if (r.length) { pr.roles = r; filled.push("target roles"); } }
  if (pr.countries.length === 0 && home) { pr.countries = [home]; filled.push("target countries"); }
  if (!pr.payCountry?.trim() && home) { pr.payCountry = home; filled.push("pay country"); }
  if (!pr.visaStatus?.trim() && p.basics.workStatus?.trim() && home) { pr.visaStatus = `${p.basics.workStatus.trim()} (${home.toUpperCase()})`; filled.push("work authorisation"); }
  return { preferences: pr, filled };
}
