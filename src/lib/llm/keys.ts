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

/**
 * A key is saved once per provider variable name (for example GEMINI_API_KEY) and used by every model row that names it,
 * so pasting one Gemini key enables all Gemini rows. It is stored under the pseudo label "env:GEMINI_API_KEY".
 */
export const envLabel = (env: string | null | undefined): string | null => (env ? `env:${env}` : null);

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
    const shareLabel = envLabel(m.api_key_env);
    const key = open(m.label, enc, sh) ?? (shareLabel ? open(shareLabel, enc, sh) : null) ?? (m.api_key_env ? process.env[m.api_key_env] : undefined);
    if (key) out.set(m.label, key);
  }
  return out;
}

export async function saveKey(label: string, apiKey: string, env?: string | null) {
  const [enc, sh] = await Promise.all([load("model_keys"), load("model_keys_shared")]);
  const labels = [label, ...(envLabel(env) ? [envLabel(env) as string] : [])];
  for (const l of labels) enc[l] = encryptSecret(apiKey, primary());
  await save("model_keys", enc);
  const s = shared();
  if (s) { for (const l of labels) sh[l] = encryptSecret(apiKey, s); await save("model_keys_shared", sh); }
}

/** Removes the key of one row and, with it, the copy shared by every row that uses the same variable name. */
export async function removeKey(label: string, env?: string | null) {
  const [enc, sh] = await Promise.all([load("model_keys"), load("model_keys_shared")]);
  for (const l of [label, ...(envLabel(env) ? [envLabel(env) as string] : [])]) { delete enc[l]; delete sh[l]; }
  await save("model_keys", enc);
  await save("model_keys_shared", sh);
}

/**
 * Give every key already saved the second (CRON_SECRET) copy. Only an environment that can read the key can do this, which is
 * normally the app on Vercel, so it runs on the hourly check. Returns how many keys were added.
 */
export async function healKeys(): Promise<number> {
  const s = shared();
  // keys that exist only as environment variables on THIS server (for example in Vercel) are invisible to the GitHub runner:
  // copy them into the encrypted store, which both can read, the first time they are seen
  const imported = (await importEnvKeys().catch(() => 0)) + (await shareSavedKeys().catch(() => 0));
  if (!s) return imported;
  const [enc, sh] = await Promise.all([load("model_keys"), load("model_keys_shared")]);
  let added = imported;
  for (const label of Object.keys(enc)) {
    if (sh[label] && decryptSecret(sh[label], s)) continue;
    const plain = decryptSecret(enc[label], primary());
    if (plain) { sh[label] = encryptSecret(plain, s); added++; }
  }
  if (added) await save("model_keys_shared", sh);
  return added;
}

/** Keys pasted on one model row before keys were shared by variable name: make them available to every row that uses the same variable. Returns how many were shared. */
export async function shareSavedKeys(): Promise<number> {
  const rows = ((await db().from("model_configs").select("label,api_key_env")).data ?? []) as { label: string; api_key_env: string | null }[];
  const enc = await load("model_keys");
  let n = 0;
  for (const m of rows) {
    const share = envLabel(m.api_key_env);
    if (!share || !enc[m.label] || enc[share]) continue;
    const plain = decryptSecret(enc[m.label], primary());
    if (plain) { await saveKey(m.label, plain, m.api_key_env); enc[share] = "done"; n++; }
  }
  return n;
}

/** Models whose key is supplied by an environment variable here but is not yet saved in the app. Returns how many were saved. */
export async function importEnvKeys(): Promise<number> {
  const rows = ((await db().from("model_configs").select("label,api_key_env")).data ?? []) as { label: string; api_key_env: string | null }[];
  const have = await storedKeyLabels();
  let n = 0;
  for (const m of rows) {
    const v = m.api_key_env ? process.env[m.api_key_env]?.trim() : undefined;
    const share = envLabel(m.api_key_env);
    if (v && !have.has(m.label) && !(share && have.has(share))) { await saveKey(m.label, v, m.api_key_env); have.add(m.label); if (share) have.add(share); n++; }
  }
  return n;
}

export type KeyReadiness = { saved: string[]; readable: string[]; unreadable: string[]; hasShared: boolean; sharedCopies: number };

/** Which saved keys can be read in THIS environment, and which cannot (and so would silently count as "no key"). */
export async function keyReadiness(): Promise<KeyReadiness> {
  const [enc, sh] = await Promise.all([load("model_keys"), load("model_keys_shared")]);
  const saved = Object.keys(enc);
  const readable = saved.filter((l) => open(l, enc, sh));
  return { saved, readable, unreadable: saved.filter((l) => !readable.includes(l)), hasShared: !!shared(), sharedCopies: Object.keys(sh).length };
}
