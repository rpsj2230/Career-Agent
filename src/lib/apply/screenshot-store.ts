import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { DEFAULT_PROOF_DAYS, planScreenshots, type ShotStage } from "./screenshot-policy";

type Row = { id: string; status: string; submitted_at: string | null; screenshot_path: string | null; job: { status: string } | { status: string }[] | null };

/**
 * Free storage: delete the pictures of applications that no longer need them (see screenshot-policy.ts). Runs with the hourly housekeeping.
 * Each application is handled in two stages and the stage reached is recorded as an event, so one that is finished is not looked at again.
 * Never throws for one bad batch: a failure leaves the files and the record alone, and the next run tries again.
 */
export async function sweepScreenshots(now = new Date(), limit = 300): Promise<{ removed: number; applications: number }> {
  const cfg = (await getSetting("retention")) as { screenshot_days?: number };
  const proofDays = cfg.screenshot_days ?? DEFAULT_PROOF_DAYS;
  const sel = "id,status,submitted_at,screenshot_path,job:jobs(status)";
  const sent = await db().from("applications").select(sel).eq("status", "submitted").order("submitted_at", { ascending: true }).limit(limit);
  const closed = await db().from("applications").select(`${sel.replace("job:jobs(status)", "job:jobs!inner(status)")}`).eq("jobs.status", "skipped").limit(limit);
  if (sent.error) throw new Error(`load sent applications: ${sent.error.message}`);
  const rows = new Map<string, Row>();
  for (const r of [...((sent.data ?? []) as unknown as Row[]), ...(closed.error ? [] : ((closed.data ?? []) as unknown as Row[]))]) rows.set(r.id, r);
  if (rows.size === 0) return { removed: 0, applications: 0 };

  const ev = await db().from("apply_events").select("application_id,detail").eq("kind", "screenshots_cleared").in("application_id", [...rows.keys()]);
  const stageOf = new Map<string, ShotStage>();
  for (const e of (ev.data ?? []) as { application_id: string; detail: { stage?: ShotStage } | null }[]) {
    const s = e.detail?.stage;
    if (s === "all" || (s === "working" && stageOf.get(e.application_id) !== "all")) stageOf.set(e.application_id, s);
  }

  const plans = [...rows.values()].flatMap((r) => {
    const job = Array.isArray(r.job) ? r.job[0] : r.job;
    const plan = planScreenshots({ id: r.id, status: r.status, submitted_at: r.submitted_at }, job?.status ?? null, now, proofDays, stageOf.get(r.id) ?? null);
    return plan ? [{ row: r, ...plan }] : [];
  });
  let removed = 0;
  for (let i = 0; i < plans.length; i += 50) {
    const batch = plans.slice(i, i + 50);
    const paths = batch.flatMap((p) => p.paths);
    const res = await db().storage.from("documents").remove(paths);
    if (res.error) { console.error(`screenshot cleanup: ${res.error.message}`); continue; }
    removed += res.data?.length ?? 0;
    for (const p of batch) {
      // the page shows a picture only when the record points at one that exists
      if (p.row.screenshot_path && p.paths.includes(p.row.screenshot_path)) await db().from("applications").update({ screenshot_path: null }).eq("id", p.row.id);
    }
    await db().from("apply_events").insert(batch.map((p) => ({ application_id: p.row.id, kind: "screenshots_cleared", detail: { stage: p.stage } })));
  }
  return { removed, applications: plans.length };
}
