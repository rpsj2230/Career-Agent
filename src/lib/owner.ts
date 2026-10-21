import { parseAllowlist } from "./access";
import { rawClient } from "./raw-client";
import { cleanTeam, type Role, type TeamMember } from "./roles";
import { sharedOnlyClient } from "./scope";
import type { ProfileRef } from "./profile-access";

/**
 * Who may use the app: the owner (first account created, stored in the database) plus any extra emails in
 * ALLOWED_EMAILS. Deliberately free of "server-only" so proxy.ts can import it.
 */
let cache: { at: number; owner: string } | null = null;
const TTL_MS = 60_000;

/** Who may sign in is app-wide, so this reaches only the shared settings (never one profile's data). */
const client = () => sharedOnlyClient(rawClient());

export async function getOwnerEmail(fresh = false): Promise<string | null> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.owner;
  const { data, error } = await client().from("settings").select("value").eq("key", "owner").maybeSingle();
  if (error) throw new Error(`load owner: ${error.message}`);
  const email = (data?.value as { email?: string } | undefined)?.email?.toLowerCase() ?? null;
  cache = email ? { at: Date.now(), owner: email } : null; // never cache "no owner", so a new claim is seen at once
  return email;
}

export async function getAllowedEmails(fresh = false): Promise<string[]> {
  const owner = await getOwnerEmail(fresh);
  return [...(owner ? [owner] : []), ...parseAllowlist(process.env.ALLOWED_EMAILS)];
}

/** Atomically make `email` the owner. Exactly one concurrent caller can win. */
export async function claimOwner(email: string): Promise<"claimed" | "taken"> {
  const { error } = await client().from("settings").insert({ key: "owner", value: { email: email.toLowerCase() } });
  if (!error) { cache = { at: Date.now(), owner: email.toLowerCase() }; return "claimed"; }
  if (error.code === "23505") return "taken";
  throw new Error(`claim owner: ${error.message}`);
}

export async function releaseOwner(): Promise<void> {
  cache = null;
  await client().from("settings").delete().eq("key", "owner");
}

/**
 * People the super admin has given limited access (Settings, Team access).
 * Not cached: the access check and the pages run in separate server bundles, so a cache could keep letting someone in after they were
 * removed. It is one small row, read once per request.
 */
export async function getTeam(): Promise<TeamMember[]> {
  const { data, error } = await client().from("settings").select("value").eq("key", "team").maybeSingle();
  if (error) throw new Error(`load team: ${error.message}`);
  return cleanTeam((data?.value as { members?: unknown } | undefined)?.members);
}

export async function saveTeam(team: TeamMember[]): Promise<void> {
  const { error } = await client().from("settings").upsert({ key: "team", value: { members: cleanTeam(team) }, updated_at: new Date().toISOString() });
  if (error) throw new Error(`save team: ${error.message}`);
}

/** The role of a signed-in email: admin for the owner and ALLOWED_EMAILS, otherwise the role given in Team access, otherwise nothing. */
export async function getRole(email: string | null | undefined, fresh = false): Promise<Role | null> {
  const e = email?.trim().toLowerCase();
  if (!e) return null;
  if ((await getAllowedEmails(fresh)).includes(e)) return "admin";
  return (await getTeam()).find((m) => m.email === e)?.role ?? null;
}

/** Role and team entry in one go (one lookup of the team, not two). Same rules as getRole and getMember. */
export async function getAccess(email: string | null | undefined): Promise<{ role: Role | null; member: TeamMember | null }> {
  const e = email?.trim().toLowerCase();
  if (!e) return { role: null, member: null };
  if ((await getAllowedEmails()).includes(e)) return { role: "admin", member: null };
  const member = (await getTeam()).find((m) => m.email === e) ?? null;
  return { role: member?.role ?? null, member };
}

/** The team entry for an email (its profiles, if the super admin named some). */
export async function getMember(email: string | null | undefined): Promise<TeamMember | null> {
  const e = email?.trim().toLowerCase();
  return e ? (await getTeam()).find((m) => m.email === e) ?? null : null;
}

/** Every profile, or none while the profiles migration has not been run (the app then behaves as a single-profile app). */
export async function loadProfileRefs(): Promise<ProfileRef[]> {
  const { error, data } = await rawClient().from("profiles").select("id,name,email,is_default,enabled").order("created_at", { ascending: true });
  if (error) {
    if (/profiles/i.test(error.message) && /(does not exist|could not find|schema cache)/i.test(error.message)) return [];
    throw new Error(`load profiles: ${error.message}`);
  }
  return (data ?? []) as ProfileRef[];
}
