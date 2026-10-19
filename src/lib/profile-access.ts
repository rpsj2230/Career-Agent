/**
 * Which profile a request works on. The super admin may open any profile; a team member only the profiles the super admin gave them
 * (their own, for a family member), and the default profile when none were named. Free of "server-only" so proxy.ts can use it.
 */
export const PROFILE_COOKIE = "career_profile";

export type ProfileRef = { id: string; name: string; email: string | null; is_default: boolean; enabled: boolean };

/** The profiles this person may open: all of them for the super admin, else the ones named for them (default profile if none). */
export function allowedProfiles(all: ProfileRef[], isAdmin: boolean, named: string[] | undefined): ProfileRef[] {
  if (isAdmin) return all;
  const ids = named?.length ? new Set(named) : null;
  return all.filter((p) => (ids ? ids.has(p.id) : p.is_default));
}

/** The profile to use: the one asked for if allowed, else the default if allowed, else the first allowed; null when there is none. */
export function pickProfile(allowed: ProfileRef[], requested: string | null | undefined): string | null {
  if (requested && allowed.some((p) => p.id === requested)) return requested;
  return (allowed.find((p) => p.is_default) ?? allowed[0])?.id ?? null;
}
