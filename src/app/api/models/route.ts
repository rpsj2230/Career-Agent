import { NextResponse } from "next/server";
import { db, must } from "@/lib/db";
import { ModelInput } from "@/lib/llm/validate";
import { logConfig } from "@/lib/activity-helpers";

/** Add or update a model (matched by label). Keys are never stored: only the NAME of the env var that holds one. */
export async function PUT(request: Request) {
  const parsed = ModelInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  must(await db().from("model_configs").upsert(parsed.data, { onConflict: "label" }).select("id"), "save model");
  await logConfig(`Model saved: ${parsed.data.label}`, { label: parsed.data.label, provider: parsed.data.provider, model: parsed.data.model, enabled: parsed.data.enabled, priority: parsed.data.priority });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  must(await db().from("model_configs").delete().eq("id", id).select("id"), "delete model");
  await logConfig("Model deleted", { id });
  return NextResponse.json({ ok: true });
}
