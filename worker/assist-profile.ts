/**
 * Which person the apply assistant on this computer works for. One assistant serves one profile, because each person is signed in to
 * their own LinkedIn / Naukri / Indeed in their own browser profile folder:
 *
 *   npm run assist                          the main profile (as before)
 *   ASSIST_FOR="Priya" npm run assist       Priya's profile, with her own sign-ins in ~/.career-agent/browser-priya
 *
 * ASSIST_FOR is the profile's name (any capitals) or its id. Free of Next.js so it can be tested.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { withProfile } from "../src/lib/profile-context";
import { rawClient } from "../src/lib/raw-client";
import { profilesEnabled } from "../src/lib/scope";

export type Who = { id: string; name: string; is_default: boolean };

export function pickByName(profiles: Who[], wanted: string | undefined): Who | { error: string } {
  const w = wanted?.trim();
  if (!w) return profiles.find((p) => p.is_default) ?? { error: "There is no main profile yet." };
  const hit = profiles.find((p) => p.id === w) ?? profiles.filter((p) => p.name.toLowerCase() === w.toLowerCase())[0];
  return hit ?? { error: `No profile is called "${w}". Profiles: ${profiles.map((p) => p.name).join(", ") || "none"}.` };
}

/** A folder name from a person's name: "Priya S." becomes "priya-s". */
export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "profile";

/** The main profile keeps the folder it always had; everyone else gets their own. ASSIST_PROFILE_DIR overrides. */
export function browserDirFor(who: Who | null, env: Record<string, string | undefined> = process.env, home = homedir()): string {
  if (env.ASSIST_PROFILE_DIR) return env.ASSIST_PROFILE_DIR;
  return join(home, ".career-agent", !who || who.is_default ? "browser" : `browser-${slug(who.name)}`);
}

export async function resolveAssistantProfile(): Promise<Who | null> {
  if (!(await profilesEnabled(rawClient()))) return null;
  const { data, error } = await rawClient().from("profiles").select("id,name,is_default");
  if (error) throw new Error(`could not read the profiles: ${error.message}`);
  const r = pickByName((data ?? []) as Who[], process.env.ASSIST_FOR);
  if ("error" in r) throw new Error(r.error);
  return r;
}

/** Runs `fn` as the profile this assistant serves (or as the single-profile app before profiles exist). */
export async function asAssistantProfile<T>(fn: (who: Who | null) => Promise<T>): Promise<T> {
  const who = await resolveAssistantProfile();
  return who ? withProfile(who.id, () => fn(who)) : fn(null);
}
