import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { parseIntegration } from "@/lib/integrations/ids";
import { setIntegrationEnabled } from "@/lib/integrations/state";

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parseIntegration((await ctx.params).id);
  if ("error" in p) return p.error;
  const body = z.object({ enabled: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "enabled (true/false) required" }, { status: 400 });
  try {
    await setIntegrationEnabled(p.def.id, body.data.enabled);
  } catch (e) {
    return NextResponse.json({ error: `Could not save: ${e instanceof Error ? e.message : e}. If this mentions a missing table, apply the update on the System page.` }, { status: 500 });
  }
  await logActivity({ kind: "integration.changed", message: `${p.def.name} ${body.data.enabled ? "enabled" : "disabled"}`, integration: p.def.id, detail: { enabled: body.data.enabled } });
  return NextResponse.json({ ok: true, note: `${p.def.name} ${body.data.enabled ? "enabled" : "disabled"}` });
}
