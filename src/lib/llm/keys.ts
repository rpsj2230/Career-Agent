import "server-only";
import { db, must } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import type { ModelRow } from "./fallback";

const master = () => {
  const m = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!m) throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set");
  return m;
};

/** label -> encrypted key, from the settings table. Plaintext keys never leave the server. */
async function loadEncrypted(): Promise<Record<string, string>> {
  const row = must<{ value: Record<string, string> } | null>(await db().from("settings").select("value").eq("key", "model_keys").maybeSingle(), "load model keys");
  return row?.value ?? {};
}

export async function storedKeyLabels(): Promise<Set<string>> {
  return new Set(Object.keys(await loadEncrypted()));
}

/** Resolve plaintext keys for the given models: a key saved in the app wins, then the named env var. */
export async function resolveKeys(rows: ModelRow[]): Promise<Map<string, string>> {
  const enc = await loadEncrypted();
  const out = new Map<string, string>();
  for (const m of rows) {
    const stored = enc[m.label] ? decryptSecret(enc[m.label], master()) : null;
    const key = stored ?? (m.api_key_env ? process.env[m.api_key_env] : undefined);
    if (key) out.set(m.label, key);
  }
  return out;
}

export async function saveKey(label: string, apiKey: string) {
  const enc = await loadEncrypted();
  enc[label] = encryptSecret(apiKey, master());
  must(await db().from("settings").upsert({ key: "model_keys", value: enc, updated_at: new Date().toISOString() }).select("key"), "save model key");
}

export async function removeKey(label: string) {
  const enc = await loadEncrypted();
  delete enc[label];
  must(await db().from("settings").upsert({ key: "model_keys", value: enc, updated_at: new Date().toISOString() }).select("key"), "remove model key");
}
