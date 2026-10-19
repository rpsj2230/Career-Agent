import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** A service-role client with no scoping at all. Free of "server-only" so proxy.ts and the workers can use it; see db.ts for the one the app uses. */
let client: SupabaseClient | null = null;
export function rawClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
