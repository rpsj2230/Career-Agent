import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { keyReadiness } from "@/lib/llm/keys";
import { localModelNeeded } from "@/lib/local-model";
import { getSetting } from "@/lib/settings";

export const maxDuration = 20;

/** Asked by the GitHub workflows before they start: should the local model be installed for this run? Returns the model name, or "". */
export async function GET() {
  try {
    const s = await getSetting("local_model");
    const since = new Date(Date.now() - 6 * 3_600_000).toISOString();
    const [ready, fails, oks] = await Promise.all([
      keyReadiness(),
      db().from("model_usage").select("id", { count: "exact", head: true }).eq("ok", false).gte("created_at", since),
      db().from("model_usage").select("id", { count: "exact", head: true }).eq("ok", true).gte("created_at", since),
    ]);
    const needed = localModelNeeded(s, ready.readable.length, { failed: fails.count ?? 0, ok: oks.count ?? 0 });
    return NextResponse.json({ local_model: needed ? s.model : "", mode: s.mode });
  } catch {
    return NextResponse.json({ local_model: "" });
  }
}
