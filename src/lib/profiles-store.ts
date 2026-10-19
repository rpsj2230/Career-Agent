import "server-only";
import { adminDb } from "@/lib/db";
import { profilesEnabled } from "@/lib/scope";
import { withProfile } from "@/lib/profile-context";
import type { ProfileRef } from "@/lib/profile-access";

export type Profile = ProfileRef & { created_at: string };

export class ProfileError extends Error {}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function cleanProfileInput(v: { name?: unknown; email?: unknown }): { name: string; email: string | null } {
  const name = typeof v.name === "string" ? v.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 1 || name.length > 80) throw new ProfileError("Give the profile a name of 1 to 80 characters.");
  const raw = typeof v.email === "string" ? v.email.trim().toLowerCase() : "";
  if (raw && (!EMAIL.test(raw) || raw.length > 200)) throw new ProfileError(`"${raw}" is not an email address.`);
  return { name, email: raw || null };
}

/** True once the profiles migration has been run. Until then the app is a single-profile app and none of this is offered. */
export const profilesReady = (): Promise<boolean> => profilesEnabled(adminDb());

export async function listProfiles(): Promise<Profile[]> {
  if (!(await profilesReady())) return [];
  const { data, error } = await adminDb().from("profiles").select("id,name,email,is_default,enabled,created_at").order("is_default", { ascending: false }).order("created_at", { ascending: true });
  if (error) throw new Error(`load profiles: ${error.message}`);
  return (data ?? []) as Profile[];
}

export async function getProfileRecord(id: string): Promise<Profile | null> {
  if (!(await profilesReady())) return null;
  const { data, error } = await adminDb().from("profiles").select("id,name,email,is_default,enabled,created_at").eq("id", id).maybeSingle();
  if (error) throw new Error(`load profile: ${error.message}`);
  return (data as Profile | null) ?? null;
}

export async function defaultProfile(): Promise<Profile | null> {
  return (await listProfiles()).find((p) => p.is_default) ?? null;
}

export { mainProfileInUse } from "@/lib/scoped-db";

export async function createProfile(v: { name: unknown; email: unknown }): Promise<Profile> {
  const c = cleanProfileInput(v);
  if ((await listProfiles()).length >= 20) throw new ProfileError("At most 20 profiles can be created.");
  const { data, error } = await adminDb().from("profiles").insert({ ...c, is_default: false }).select("id,name,email,is_default,enabled,created_at").single();
  if (error) throw new Error(`create profile: ${error.message}`);
  return data as Profile;
}

export async function updateProfile(id: string, v: { name?: unknown; email?: unknown; enabled?: unknown }): Promise<Profile> {
  const cur = await getProfileRecord(id);
  if (!cur) throw new ProfileError("That profile does not exist.");
  const c = cleanProfileInput({ name: v.name ?? cur.name, email: v.email === undefined ? cur.email : v.email });
  const enabled = typeof v.enabled === "boolean" ? v.enabled : cur.enabled;
  const { data, error } = await adminDb().from("profiles").update({ ...c, enabled }).eq("id", id).select("id,name,email,is_default,enabled,created_at").single();
  if (error) throw new Error(`update profile: ${error.message}`);
  return data as Profile;
}

/** Tables holding a profile's data, children first, so nothing is blocked by the "a job with an application cannot be deleted" protection. */
const DELETE_ORDER = ["apply_events", "activity_log", "applications", "documents", "job_scores", "jobs", "automation_runs", "portal_scans", "schedules", "daily_reports", "country_prefs", "integrations", "answer_bank", "settings", "profile"];

/** Permanently removes a profile and everything it owns (including its stored resume files). The default profile cannot be deleted. */
export async function deleteProfile(id: string): Promise<void> {
  const cur = await getProfileRecord(id);
  if (!cur) throw new ProfileError("That profile does not exist.");
  if (cur.is_default) throw new ProfileError("The main profile cannot be deleted.");
  const sb = adminDb();
  const files = await sb.from("documents").select("storage_path").eq("profile_id", id).not("storage_path", "is", null);
  const paths = ((files.data ?? []) as { storage_path: string }[]).map((f) => f.storage_path);
  for (let i = 0; i < paths.length; i += 100) await sb.storage.from("documents").remove(paths.slice(i, i + 100)).catch(() => undefined);
  for (const t of DELETE_ORDER) {
    const { error } = await sb.from(t).delete().eq("profile_id", id);
    if (error) throw new Error(`delete ${t}: ${error.message}`);
  }
  const { error } = await sb.from("profiles").delete().eq("id", id);
  if (error) throw new Error(`delete profile: ${error.message}`);
}

/** The profiles the automation works for: switched on, in order. */
export async function activeProfiles(): Promise<Profile[]> {
  return (await listProfiles()).filter((p) => p.enabled);
}

/**
 * Runs `fn` once for each profile that is switched on (or just `only`), each inside its own profile context, one after another. A failure in
 * one profile is reported and never stops the others. Without the profiles migration it runs once with no profile (the single-profile app).
 */
export async function forEachProfile<T>(fn: (p: Profile | null) => Promise<T>, o: { only?: string | null; onError?: (p: Profile | null, e: unknown) => void } = {}): Promise<{ profile: Profile | null; result?: T; error?: unknown }[]> {
  const onError = o.onError ?? ((p, e) => console.error(`${p ? `[${p.name}] ` : ""}failed:`, e));
  if (!(await profilesReady())) {
    try { return [{ profile: null, result: await fn(null) }]; } catch (e) { onError(null, e); return [{ profile: null, error: e }]; }
  }
  const out: { profile: Profile | null; result?: T; error?: unknown }[] = [];
  const list = o.only ? (await listProfiles()).filter((p) => p.id === o.only) : await activeProfiles();
  for (const p of list) {
    try { out.push({ profile: p, result: await withProfile(p.id, () => fn(p)) }); } catch (e) { onError(p, e); out.push({ profile: p, error: e }); }
  }
  return out;
}

/** The profile an application belongs to (null before the profiles migration, or if there is no such application). */
export async function profileOfApplication(id: string): Promise<string | null> {
  if (!(await profilesReady())) return null;
  const { data } = await adminDb().from("applications").select("profile_id").eq("id", id).maybeSingle();
  return (data?.profile_id as string | undefined) ?? null;
}
