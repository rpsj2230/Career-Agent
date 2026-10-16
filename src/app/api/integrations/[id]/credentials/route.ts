import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { removeCredentials, saveCredentials } from "@/lib/integrations/credentials";
import { parseIntegration } from "@/lib/integrations/ids";

const Body = z.object({ values: z.record(z.string(), z.string().trim().min(4).max(300).regex(/^\S+$/, "Keys contain no spaces")) });

/** Saves provider credentials encrypted. Values are never returned or logged. */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parseIntegration((await ctx.params).id);
  if ("error" in p) return p.error;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid credentials" }, { status: 400 });
  try {
    await saveCredentials(p.def.id, body.data.values);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save" }, { status: 400 });
  }
  await logActivity({ kind: "config.changed", message: `${p.def.name} credentials saved`, integration: p.def.id, detail: { fields: Object.keys(body.data.values) } });
  return NextResponse.json({ ok: true, note: "Saved (encrypted). Press Test to check it." });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parseIntegration((await ctx.params).id);
  if ("error" in p) return p.error;
  await removeCredentials(p.def.id);
  await logActivity({ kind: "config.changed", message: `${p.def.name} saved credentials removed`, integration: p.def.id });
  return NextResponse.json({ ok: true, note: "Saved credentials removed" });
}
