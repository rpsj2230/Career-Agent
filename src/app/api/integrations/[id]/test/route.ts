import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { resolveCredentials } from "@/lib/integrations/credentials";
import { parseIntegration } from "@/lib/integrations/ids";
import { recordIntegrationTest } from "@/lib/integrations/state";
import { effectiveDiscovery } from "@/lib/jobs/discover";
import { testIntegration } from "@/lib/jobs/sources";

export const maxDuration = 30;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parseIntegration((await ctx.params).id);
  if ("error" in p) return p.error;
  const [{ creds }, settings] = await Promise.all([resolveCredentials(), effectiveDiscovery()]);
  const r = await testIntegration(p.def.id, creds, settings);
  await recordIntegrationTest(p.def.id, r.ok, r.message);
  await logActivity({ kind: r.ok ? "integration.tested" : "integration.error", level: r.ok ? "info" : "error", message: `${p.def.name} test ${r.ok ? "passed" : "failed"}: ${r.message}`, integration: p.def.id, status: r.ok ? "ok" : "error" });
  return r.ok ? NextResponse.json({ ok: true, note: r.message }) : NextResponse.json({ error: r.message }, { status: 422 });
}
