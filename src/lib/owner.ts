import { createClient } from "@supabase/supabase-js";
import { parseAllowlist } from "./access";

/**
 * Who may use the app: the owner (first account created, stored in the database) plus any extra emails in
 * ALLOWED_EMAILS. Deliberately free of "server-only" so proxy.ts can import it.
 */
let cache: { at: number; owner: string } | null = null;
const TTL_MS = 60_000;

function client() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, key, { auth: { persistSession: false } });
}

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
