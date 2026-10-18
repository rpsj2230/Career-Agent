import { NextResponse } from "next/server";
import { z } from "zod";
import { db, must } from "@/lib/db";
import { removeKey, saveKey } from "@/lib/llm/keys";
import { logConfig } from "@/lib/activity-helpers";

const Body = z.object({ label: z.string().min(1), apiKey: z.string().trim().min(8).max(500).regex(/^\S+$/, "A key has no spaces") });

async function find(label: string) {
  return must<{ label: string; api_key_env: string | null } | null>(await db().from("model_configs").select("label,api_key_env").eq("label", label).maybeSingle(), "find model");
}

/** Save a provider key encrypted in the app. It is never returned by any endpoint. */
export async function PUT(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid key" }, { status: 400 });
  const row = await find(parsed.data.label);
  if (!row) return NextResponse.json({ error: "Unknown model" }, { status: 404 });
  await saveKey(parsed.data.label, parsed.data.apiKey, row.api_key_env);
  await logConfig(`API key saved for model ${parsed.data.label}${row.api_key_env ? ` (shared by every model that uses ${row.api_key_env})` : ""}`, { label: parsed.data.label });
  return NextResponse.json({ ok: true, note: row.api_key_env ? `Key saved (encrypted) for every model that uses ${row.api_key_env}` : "Key saved (encrypted)" });
}

export async function DELETE(request: Request) {
  const label = new URL(request.url).searchParams.get("label");
  if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
  await removeKey(label, (await find(label))?.api_key_env);
  await logConfig(`Saved API key removed for model ${label}`, { label });
  return NextResponse.json({ ok: true, note: "Saved key removed" });
}
