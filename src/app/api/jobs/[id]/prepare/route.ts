import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { dispatchWorkflow, workerConfigured } from "@/lib/apply/dispatch";
import { prepareApplication } from "@/lib/apply/prepare";
import { noteBackgroundStart } from "@/lib/background-status";
import { within } from "@/lib/time-limit";

export const maxDuration = 60;

/**
 * Prepare the resume, cover letter and answers for one job. Writing them takes several model calls, which can pass the website host's
 * 60-second limit, so with GitHub connected it starts there and answers at once; otherwise it runs here and always replies by 55 s.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let why = "";
  if (workerConfigured()) {
    const err = await dispatchWorkflow("task.yml", { task: "prepare", job_id: id });
    if (!err) {
      await noteBackgroundStart("prepare");
      await logActivity({ kind: "schedule.changed", message: "Preparing an application started in the background (from the site)", status: "dispatched", job_id: id, detail: { where: "github-actions" } }).catch(() => undefined);
      return NextResponse.json({ ok: true, where: "github", note: "Preparing in the background (usually 1-3 minutes). It will appear under Applications as prepared." });
    }
    why = `GitHub did not start it (${err}); `;
  }
  const work = (async (): Promise<Response> => {
    try {
      return NextResponse.json({ ok: true, ...(await prepareApplication(id)) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Preparation failed" }, { status: 422 });
    }
  })();
  return within(work, 55_000, () => NextResponse.json({ ok: true, note: `${why}This is taking longer than a web request allows. It keeps going and will appear under Applications when done; if it does not, press the button again.` }));
}
