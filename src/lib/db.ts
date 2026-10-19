import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rawClient } from "@/lib/raw-client";
import { scopedDb } from "@/lib/scoped-db";

/**
 * Service-role client with NO profile scoping. Only for things that genuinely span profiles (listing and managing the profiles themselves,
 * model rows and usage, the automation choosing which profile to work for) and always with the profile named explicitly. Server code only.
 */
export const adminDb = (): SupabaseClient => rawClient();

/** Service-role client for the profile currently in use: every per-person table is filtered to it. Server code only; never import from a client component. */
export const db = (): SupabaseClient => scopedDb();

/** Throw on a Supabase error so callers never silently continue with missing data. */
export function must<T>(res: { data: unknown; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}
