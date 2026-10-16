import "server-only";
import { db } from "@/lib/db";
import { isMissingSchemaError } from "@/lib/schema";
import { sendTelegram } from "@/lib/notify";
import { integrationById, type IntegrationId, type IntegrationState } from "./catalog";
import { transitionAlert } from "./health";

export type IntegrationRow = IntegrationState & { id: IntegrationId; jobs_found_total: number };

/** Loads integration state. If the migration has not been applied yet, returns no rows and says so. */
export async function loadIntegrationStates(): Promise<{ states: Map<IntegrationId, IntegrationRow>; schemaMissing: boolean }> {
  const { data, error } = await db().from("integrations").select("*");
  if (error) {
    if (isMissingSchemaError(error.message)) return { states: new Map(), schemaMissing: true };
    throw new Error(`load integrations: ${error.message}`);
  }
  return { states: new Map((data as IntegrationRow[]).map((r) => [r.id, r])), schemaMissing: false };
}

async function upsert(id: IntegrationId, patch: Record<string, unknown>) {
  const { data } = await db().from("integrations").select("enabled,jobs_found_total").eq("id", id).maybeSingle();
  const cur = data as { enabled: boolean; jobs_found_total: number } | null;
  const { error } = await db().from("integrations").upsert({ id, enabled: cur?.enabled ?? true, ...patch, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return cur;
}

/** Called after scans. Never throws: a missing table must not break discovery. */
export async function recordIntegrationScan(id: IntegrationId, r: { ok: boolean; error?: string; inserted: number }) {
  try {
    const now = new Date().toISOString();
    const cur = (await db().from("integrations").select("jobs_found_total,status").eq("id", id).maybeSingle()).data as { jobs_found_total: number; status?: string } | null;
    await upsert(id, {
      last_scan_at: now,
      ...(r.ok ? { last_ok_at: now, status: "ok" } : { last_error: r.error?.slice(0, 1000), last_error_at: now, status: "error" }),
      jobs_found_total: (cur?.jobs_found_total ?? 0) + r.inserted,
    });
    // tell you once when a source breaks or recovers (repeat failures stay in the logs and on the dashboard)
    const alert = transitionAlert(cur?.status, r.ok, integrationById(id)?.name ?? id, r.error);
    if (alert) await sendTelegram(alert);
  } catch (e) { console.error(`[integrations] could not record scan for ${id}: ${e instanceof Error ? e.message : e}`); }
}

export async function recordIntegrationTest(id: IntegrationId, ok: boolean, message: string) {
  try {
    await upsert(id, { last_test_at: new Date().toISOString(), last_test_ok: ok, last_test_message: message.slice(0, 1000), status: ok ? "ok" : "error" });
  } catch (e) { console.error(`[integrations] could not record test for ${id}: ${e instanceof Error ? e.message : e}`); }
}

export async function setIntegrationEnabled(id: IntegrationId, enabled: boolean) {
  await upsert(id, { enabled, status: enabled ? "unknown" : "disabled" });
}
