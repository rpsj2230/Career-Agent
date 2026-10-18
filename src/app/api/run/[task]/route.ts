import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { dispatchWorkflow, workerConfigured } from "@/lib/apply/dispatch";
import { noteBackgroundStart } from "@/lib/background-status";
import { listSchedules } from "@/lib/schedule-store";
import { GET as discoverInline } from "../../cron/discover/route";
import { GET as scoreInline } from "../../cron/score/route";

export const maxDuration = 60;

/**
 * "Find jobs now" and "Score new jobs". With GitHub connected the work starts there (no time limit, several minutes are fine) and this
 * answers at once; otherwise a short, time-boxed version runs inside the request. The reply says which happened.
 */
export async function POST(request: Request, { params }: { params: Promise<{ task: string }> }) {
  const { task } = await params;
  if (task === "localtest") {
    if (!workerConfigured()) return NextResponse.json({ error: "Testing the local model needs GitHub connected (System > Automation), because the local model runs on GitHub's computer." }, { status: 409 });
    const err = await dispatchWorkflow("task.yml", { task: "localtest" });
    if (err) return NextResponse.json({ error: `GitHub did not start the test: ${err}` }, { status: 502 });
    await logActivity({ kind: "config.changed", message: "Started a test of the local model on GitHub", status: "dispatched" }).catch(() => undefined);
    return NextResponse.json({ ok: true, where: "github", note: "Test started on GitHub. It downloads the model and asks it a real job-scoring question; this takes about 3 to 6 minutes. Refresh this page to see the result." });
  }
  if (task !== "discover" && task !== "score" && task !== "all") return NextResponse.json({ error: "Unknown task" }, { status: 404 });
  const label = task === "discover" ? "Search and score" : task === "all" ? "The full cycle" : "Scoring";

  // the whole cycle (search, score, prepare) is your schedule's job: start it now instead of waiting for its time
  if (task === "all") {
    const sched = (await listSchedules().catch(() => ({ rows: [] }))).rows.find((s) => s.enabled && !s.paused);
    if (!sched) return NextResponse.json({ error: "There is no active schedule. Open Schedules and create or resume one." }, { status: 409 });
    if (workerConfigured()) {
      const err = await dispatchWorkflow("pipeline.yml", { schedule_id: sched.id });
      if (!err) {
        await noteBackgroundStart("pipeline");
        await logActivity({ kind: "schedule.changed", message: `Full cycle started now: ${sched.name}`, status: "dispatched", detail: { schedule_id: sched.id, where: "github-actions" } }).catch(() => undefined);
        return NextResponse.json({ ok: true, where: "github", note: `Started "${sched.name}" now: search, score and prepare. It runs in the background (about 10 to 30 minutes); this page shows progress.` });
      }
      return NextResponse.json({ error: `GitHub did not start it: ${err}` }, { status: 502 });
    }
    return NextResponse.json({ error: "Running the full cycle needs GitHub connected (System > Automation). Use the Search and Score buttons for a short version here." }, { status: 409 });
  }

  let why = "";
  if (workerConfigured()) {
    const err = await dispatchWorkflow("task.yml", { task });
    if (!err) {
      await noteBackgroundStart(task);
      await logActivity({ kind: "schedule.changed", message: `${label} started in the background (from the site)`, status: "dispatched", detail: { task, where: "github-actions" } }).catch(() => undefined);
      return NextResponse.json({ ok: true, where: "github", note: `${label} started in the background. It takes a few minutes; this page shows its progress, and the results appear in the Review queue.` });
    }
    why = `GitHub did not start it (${err}). `;
  }
  const res = await (task === "discover" ? discoverInline : scoreInline)(request);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return NextResponse.json(body, { status: res.status });
  const short = task === "discover"
    ? `${why}Ran a short version here (limited to about a minute): ${body.inserted ?? 0} new job(s) found.`
    : `${why}Ran a short version here (limited to about a minute): ${body.scored ?? 0} scored, ${body.queued ?? 0} matched, ${body.remaining ?? 0} still waiting.`;
  return NextResponse.json({ ok: true, where: "inline", note: `${short}${workerConfigured() ? "" : " Connect GitHub (System > Automation) to run the full version in the background."}`, ...body });
}
