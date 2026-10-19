import type { SupabaseClient } from "@supabase/supabase-js";
import { currentProfileId } from "./profile-context";
import { rawClient } from "./raw-client";
import { profilesEnabled, scopeClient, type Scope } from "./scope";

/**
 * The scoped database client, for the app (through db.ts) and for the workers that run outside Next.js. Free of "server-only" for that reason.
 * It must never reach a browser bundle: it holds the service-role key.
 */
let scoped: SupabaseClient | null = null;

async function scope(): Promise<Scope> {
  return (await profilesEnabled(rawClient())) ? { kind: "profiles", profileId: currentProfileId } : { kind: "legacy" };
}

export function scopedDb(): SupabaseClient {
  return (scoped ??= scopeClient(rawClient(), scope));
}

/** Is the profile in use the main (first) one, or are profiles not set up yet? Settings that live in the environment belong to the main profile only. */
export async function mainProfileInUse(): Promise<boolean> {
  if (!(await profilesEnabled(rawClient()))) return true;
  const { data } = await rawClient().from("profiles").select("id").eq("is_default", true).maybeSingle();
  return !!data && data.id === (await currentProfileId());
}
