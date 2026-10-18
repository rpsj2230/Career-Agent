import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { dispatchWorkflow, workerConfigured } from "@/lib/apply/dispatch";
import { noteBackgroundStart } from "@/lib/background-status";
import { GET as discoverInline } from "../../cron/discover/route";
import { GET as scoreInline } from "../../cron/score/route";

export const maxDuration = 60;

/**
 * "Find jobs now" and "Score new jobs". With GitHub connected the work starts there (no time limit, several minutes are fine) and this
 * answers at once; otherwise a short, time-boxed version runs inside the request. The reply says which happened.
 */
export async function POST(request: Request, { params }: { params: Promise<{ task: string }> }) {
  const { task } = await params;
  if (task !== "discover" && task !== "score") return NextResponse.json({ error: "Unknown task" }, { status: 404 });
  const label = task === "discover" ? "Search and score" : "Scoring";

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
