import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { dispatchWorkflow, workerConfigured } from "@/lib/apply/dispatch";
import { liveDeps } from "@/lib/pipeline/deps";
import { runPipeline } from "@/lib/pipeline/run";
import { getSchedule, recordScheduleRun } from "@/lib/schedule-store";

export const maxDuration = 60;

/**
 * "Run now". The full pipeline (models, document generation, browser) runs in GitHub Actions. If that is not connected,
 * the part that fits in a web request runs here (search and scoring) and the response says what was left out.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const s = await getSchedule(id);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (workerConfigured()) {
    const err = await dispatchWorkflow("pipeline.yml", { schedule_id: id });
    if (err) return NextResponse.json({ error: err }, { status: 502 });
    await logActivity({ kind: "schedule.changed", message: `Run now requested: ${s.name}`, status: "dispatched", detail: { schedule_id: id, where: "github-actions" } });
    return NextResponse.json({ ok: true, where: "worker", note: "Started. It takes a few minutes; follow it under Logs > Runs." });
  }

  try {
    const sum = await runPipeline({ ...s, mode: "scan" }, liveDeps(), { trigger: "manual", budgetMs: 50_000 });
    await recordScheduleRun(id, sum.partial ? "partial" : "succeeded");
    const left = s.mode === "scan" ? "" : " Preparing and applying need the GitHub worker (set GITHUB_REPO and GITHUB_DISPATCH_TOKEN); they were not run.";
    return NextResponse.json({ ok: true, where: "inline", runId: sum.runId, note: `Found ${sum.inserted} new job(s), scored ${sum.scored}, matched ${sum.matched}.${left}` });
  } catch (e) {
    await recordScheduleRun(id, "failed").catch(() => undefined);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Run failed" }, { status: 422 });
  }
}
