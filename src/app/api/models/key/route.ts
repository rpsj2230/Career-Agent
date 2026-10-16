import { NextResponse } from "next/server";
import { z } from "zod";
import { db, must } from "@/lib/db";
import { removeKey, saveKey } from "@/lib/llm/keys";

const Body = z.object({ label: z.string().min(1), apiKey: z.string().trim().min(8).max(500).regex(/^\S+$/, "A key has no spaces") });

async function exists(label: string) {
  return !!must<{ label: string } | null>(await db().from("model_configs").select("label").eq("label", label).maybeSingle(), "find model");
}

/** Save a provider key encrypted in the app. It is never returned by any endpoint. */
export async function PUT(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid key" }, { status: 400 });
  if (!(await exists(parsed.data.label))) return NextResponse.json({ error: "Unknown model" }, { status: 404 });
  await saveKey(parsed.data.label, parsed.data.apiKey);
  return NextResponse.json({ ok: true, note: "Key saved (encrypted)" });
}

export async function DELETE(request: Request) {
  const label = new URL(request.url).searchParams.get("label");
  if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
  await removeKey(label);
  return NextResponse.json({ ok: true, note: "Saved key removed" });
}
