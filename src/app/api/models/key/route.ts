import { NextResponse } from "next/server";
import { z } from "zod";
import { db, must } from "@/lib/db";
import { baseEnv, MAX_KEYS, removeKey, saveEnvKey, saveKey, slotEnv } from "@/lib/llm/keys";
import { logConfig } from "@/lib/activity-helpers";

const Body = z.object({ label: z.string().min(1).optional(), env: z.string().regex(/^[A-Z][A-Z0-9_]{2,60}$/).optional(), apiKey: z.string().trim().min(8).max(500).regex(/^\S+$/, "A key has no spaces") });

async function find(label: string) {
  return must<{ label: string; api_key_env: string | null } | null>(await db().from("model_configs").select("label,api_key_env").eq("label", label).maybeSingle(), "find model");
}

/** Does a model use this key name (or another key of the same provider pool)? Only such names may be saved, so this cannot store arbitrary settings. */
async function inPool(env: string): Promise<boolean> {
  const rows = must<{ api_key_env: string | null }[]>(await db().from("model_configs").select("api_key_env"), "list key names");
  const pools = new Set(rows.map((r) => r.api_key_env).filter((e): e is string => !!e).map(baseEnv));
  const base = baseEnv(env);
  return pools.has(base) && Array.from({ length: MAX_KEYS }, (_, i) => slotEnv(base, i + 1)).includes(env);
}

/** Save a provider key encrypted in the app, either for one model row (label) or as key N of a provider (env). It is never returned by any endpoint. */
export async function PUT(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid key" }, { status: 400 });
  const { label, env, apiKey } = parsed.data;
  if (env) {
    if (!(await inPool(env))) return NextResponse.json({ error: "Unknown key name" }, { status: 404 });
    await saveEnvKey(env, apiKey);
    await logConfig(`API key saved for ${env}`, { env });
    return NextResponse.json({ ok: true, note: `Key saved (encrypted) for ${env}` });
  }
  if (!label) return NextResponse.json({ error: "label or env required" }, { status: 400 });
  const row = await find(label);
  if (!row) return NextResponse.json({ error: "Unknown model" }, { status: 404 });
  await saveKey(label, apiKey, row.api_key_env);
  await logConfig(`API key saved for model ${label}${row.api_key_env ? ` (shared by every model that uses ${row.api_key_env})` : ""}`, { label });
  return NextResponse.json({ ok: true, note: row.api_key_env ? `Key saved (encrypted) for every model that uses ${row.api_key_env}` : "Key saved (encrypted)" });
}

export async function DELETE(request: Request) {
  const label = new URL(request.url).searchParams.get("label");
  if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
  await removeKey(label, (await find(label))?.api_key_env);
  await logConfig(`Saved API key removed for model ${label}`, { label });
  return NextResponse.json({ ok: true, note: "Saved key removed" });
}
