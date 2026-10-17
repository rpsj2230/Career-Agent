import { NextResponse } from "next/server";
import { parseIntegration } from "@/lib/integrations/ids";
import { discoverNow } from "@/lib/jobs/discover";

export const maxDuration = 60;

/** "Scan now" for one integration, recorded as a manual run with per-query scan records. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parseIntegration((await ctx.params).id);
  if ("error" in p) return p.error;
  if (!p.def.discovers) return NextResponse.json({ error: `${p.def.name} does not scan; add jobs from the Review queue.` }, { status: 409 });
  try {
    const res = await discoverNow({ trigger: "manual", only: p.def.id, budgetMs: 45_000, force: true });
    const sum = (k: "fetched" | "inserted" | "duplicates") => res.outcomes.reduce((n, o) => n + o.counts[k], 0);
    const failed = res.outcomes.filter((o) => !o.ok);
    if (res.outcomes.length > 0 && failed.length === res.outcomes.length) return NextResponse.json({ error: `All ${failed.length} scan(s) failed. First: ${failed[0].error}` }, { status: 422 });
    const note = `${res.outcomes.length} scan(s): ${sum("fetched")} jobs fetched, ${sum("inserted")} new, ${sum("duplicates")} already known${failed.length ? `, ${failed.length} failed (see Logs)` : ""}${res.skipped ? `. ${res.skipped} not started (time limit): press again` : ""}.`;
    return NextResponse.json({ ok: true, note: res.outcomes.length === 0 ? "Nothing to scan: check that roles are set and the integration is connected." : note });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Scan failed" }, { status: 422 });
  }
}
