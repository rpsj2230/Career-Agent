import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { dispatchWorkflow, workerConfigured } from "@/lib/apply/dispatch";
import { prepareApplication } from "@/lib/apply/prepare";
import { db, must } from "@/lib/db";
import { noteBackgroundStart } from "@/lib/background-status";
import { within } from "@/lib/time-limit";

export const maxDuration = 60;

const Body = z.object({ guidance: z.string().max(600).optional(), confirmSubmitted: z.boolean().optional() });

/**
 * Write a new resume and cover letter for an application that already exists, and put it back to "Pending approval".
 * The old versions stay in the history. An application that was already sent needs `confirmSubmitted`. It runs on GitHub when connected
 * (several model calls can pass the website host's 60 s limit); otherwise it runs here and always answers by 55 s.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { guidance, confirmSubmitted } = parsed.data;

  const app = must<{ id: string; job_id: string; status: string } | null>(await db().from("applications").select("id,job_id,status").eq("id", id).maybeSingle(), "load application");
  if (!app) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  if (["approved", "submitting"].includes(app.status)) return NextResponse.json({ error: "This application is being sent right now. Wait until it finishes, then regenerate." }, { status: 409 });
  if (app.status === "submitted" && !confirmSubmitted) return NextResponse.json({ error: "This application was already submitted. Confirm that you want a new version and to apply again.", needsConfirm: true }, { status: 409 });

  let why = "";
  if (workerConfigured()) {
    const err = await dispatchWorkflow("task.yml", { task: "regenerate", job_id: app.job_id, guidance: guidance ?? "", confirm: confirmSubmitted ? "1" : "" });
    if (!err) {
      await noteBackgroundStart("prepare");
      await logActivity({ kind: "schedule.changed", message: "Regenerating an application's resume started in the background (from the site)", status: "dispatched", job_id: app.job_id, application_id: id, detail: { where: "github-actions", guidance: guidance ?? null } }).catch(() => undefined);
      return NextResponse.json({ ok: true, where: "github", note: "Writing a new resume and cover letter in the background (usually 1 to 3 minutes). Refresh this page: the application goes back to Pending approval with the new version." });
    }
    why = `GitHub did not start it (${err}); `;
  }
  const work = (async (): Promise<Response> => {
    try {
      const r = await prepareApplication(app.job_id, null, { regenerate: true, guidance, confirmSubmitted });
      return NextResponse.json({ ok: true, where: "inline", note: "A new resume and cover letter were written. The application is back to Pending approval.", ...r });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Regeneration failed" }, { status: 422 });
    }
  })();
  return within(work, 55_000, () => NextResponse.json({ ok: true, note: `${why}This is taking longer than a web request allows. It keeps going; refresh the page in a minute.` }));
}
