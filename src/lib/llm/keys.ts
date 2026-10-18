import "server-only";
import { db, must } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import type { ModelRow } from "./fallback";

/**
 * Model keys saved in the app are stored encrypted, twice:
 *  - under SUPABASE_SERVICE_ROLE_KEY (the original way), and
 *  - under CRON_SECRET, which the app (Vercel) and the GitHub runner are already required to share.
 * The runner can therefore read the keys even if the Supabase key written in GitHub is a different (still valid) key from the one in
 * Vercel, which used to leave it with "no model available" and no visible reason. Either secret is enough to read a key.
 */
const primary = () => {
  const m = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!m) throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set");
  return m;
};
const shared = () => process.env.CRON_SECRET?.trim() || null;

type Store = Record<string, string>;
async function load(key: "model_keys" | "model_keys_shared"): Promise<Store> {
  const row = must<{ value: Store } | null>(await db().from("settings").select("value").eq("key", key).maybeSingle(), `load ${key}`);
  return row?.value ?? {};
}
async function save(key: "model_keys" | "model_keys_shared", value: Store) {
  must(await db().from("settings").upsert({ key, value, updated_at: new Date().toISOString() }).select("key"), `save ${key}`);
}

export async function storedKeyLabels(): Promise<Set<string>> {
  return new Set(Object.keys(await load("model_keys")));
}

/** The plaintext key for one label, trying each secret in turn; null when none of them opens it. */
function open(label: string, enc: Store, sh: Store): string | null {
  const a = enc[label] ? decryptSecret(enc[label], primary()) : null;
  if (a) return a;
  const s = shared();
  return s && sh[label] ? decryptSecret(sh[label], s) : null;
}

/** Resolve plaintext keys for the given models: a key saved in the app wins, then the named env var. */
export async function resolveKeys(rows: ModelRow[]): Promise<Map<string, string>> {
  const [enc, sh] = await Promise.all([load("model_keys"), load("model_keys_shared")]);
  const out = new Map<string, string>();
  for (const m of rows) {
    const key = open(m.label, enc, sh) ?? (m.api_key_env ? process.env[m.api_key_env] : undefined);
    if (key) out.set(m.label, key);
  }
  return out;
}

export async function saveKey(label: string, apiKey: string) {
  const [enc, sh] = await Promise.all([load("model_keys"), load("model_keys_shared")]);
  enc[label] = encryptSecret(apiKey, primary());
  await save("model_keys", enc);
  const s = shared();
  if (s) { sh[label] = encryptSecret(apiKey, s); await save("model_keys_shared", sh); }
}

export async function removeKey(label: string) {
  const [enc, sh] = await Promise.all([load("model_keys"), load("model_keys_shared")]);
  delete enc[label]; delete sh[label];
  await save("model_keys", enc);
  await save("model_keys_shared", sh);
}

/**
 * Give every key already saved the second (CRON_SECRET) copy. Only an environment that can read the key can do this, which is
 * normally the app on Vercel, so it runs on the hourly check. Returns how many keys were added.
 */
export async function healKeys(): Promise<number> {
  const s = shared();
  if (!s) return 0;
  const [enc, sh] = await Promise.all([load("model_keys"), load("model_keys_shared")]);
  let added = 0;
  for (const label of Object.keys(enc)) {
    if (sh[label] && decryptSecret(sh[label], s)) continue;
    const plain = decryptSecret(enc[label], primary());
    if (plain) { sh[label] = encryptSecret(plain, s); added++; }
  }
  if (added) await save("model_keys_shared", sh);
  return added;
}

export type KeyReadiness = { saved: string[]; readable: string[]; unreadable: string[]; hasShared: boolean; sharedCopies: number };

/** Which saved keys can be read in THIS environment, and which cannot (and so would silently count as "no key"). */
export async function keyReadiness(): Promise<KeyReadiness> {
  const [enc, sh] = await Promise.all([load("model_keys"), load("model_keys_shared")]);
  const saved = Object.keys(enc);
  const readable = saved.filter((l) => open(l, enc, sh));
  return { saved, readable, unreadable: saved.filter((l) => !readable.includes(l)), hasShared: !!shared(), sharedCopies: Object.keys(sh).length };
}
