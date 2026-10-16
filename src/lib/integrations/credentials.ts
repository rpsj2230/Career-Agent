import "server-only";
import { db, must } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import type { IntegrationCreds } from "@/lib/jobs/sources";
import { INTEGRATIONS, integrationById, type IntegrationId } from "./catalog";

const STORE_KEY = "integration_keys";
const master = () => {
  const m = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!m) throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set");
  return m;
};

async function loadEncrypted(): Promise<Record<string, string>> {
  const row = must<{ value: Record<string, string> } | null>(await db().from("settings").select("value").eq("key", STORE_KEY).maybeSingle(), "load integration keys");
  return row?.value ?? {};
}

async function saveEncrypted(enc: Record<string, string>) {
  must(await db().from("settings").upsert({ key: STORE_KEY, value: enc, updated_at: new Date().toISOString() }).select("key"), "save integration keys");
}

export type CredentialSource = "app" | "env" | null;

export type CredentialReport = {
  /** Decrypted values for use by scans. Server side only; never sent to the browser. */
  creds: IntegrationCreds;
  /** Per integration, per key: where the value comes from. Safe to send to the browser. */
  sources: Record<string, Record<string, CredentialSource>>;
};

/** A value saved in the app wins; otherwise the named environment variable. */
export async function resolveCredentials(): Promise<CredentialReport> {
  const enc = await loadEncrypted();
  const creds: IntegrationCreds = {};
  const sources: CredentialReport["sources"] = {};
  for (const def of INTEGRATIONS) {
    const values: Record<string, string> = {};
    sources[def.id] = {};
    for (const c of def.credentials) {
      const stored = enc[`${def.id}.${c.key}`] ? decryptSecret(enc[`${def.id}.${c.key}`], master()) : null;
      const envVal = c.env ? process.env[c.env] : undefined;
      const v = stored ?? envVal;
      sources[def.id][c.key] = stored ? "app" : envVal ? "env" : null;
      if (v) values[c.key] = v;
    }
    if (def.credentials.length > 0 && def.credentials.filter((c) => !c.optional).every((c) => values[c.key])) {
      if (def.id === "adzuna") creds.adzuna = { app_id: values.app_id, app_key: values.app_key };
      if (def.id === "jsearch") creds.jsearch = { rapidapi_key: values.rapidapi_key };
      if (def.id === "mailbox") creds.mailbox = { host: values.imap_host, user: values.imap_user, password: values.imap_password, folder: values.imap_folder, port: values.imap_port ? Number(values.imap_port) : undefined };
    }
  }
  return { creds, sources };
}

export const isComplete = (id: IntegrationId, sources: CredentialReport["sources"]) => {
  const def = integrationById(id);
  return !!def && def.credentials.filter((c) => !c.optional).every((c) => sources[id]?.[c.key]);
};

export async function saveCredentials(id: IntegrationId, values: Record<string, string>) {
  const def = integrationById(id);
  if (!def) throw new Error("Unknown integration");
  const enc = await loadEncrypted();
  for (const [k, v] of Object.entries(values)) {
    if (!def.credentials.some((c) => c.key === k)) throw new Error(`Unknown credential "${k}"`);
    enc[`${id}.${k}`] = encryptSecret(v, master());
  }
  await saveEncrypted(enc);
}

export async function removeCredentials(id: IntegrationId) {
  const enc = await loadEncrypted();
  for (const k of Object.keys(enc)) if (k.startsWith(`${id}.`)) delete enc[k];
  await saveEncrypted(enc);
}
