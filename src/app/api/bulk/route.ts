import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { approveApplication } from "@/lib/apply/approve";
import { dispatchWorkflow, workerConfigured } from "@/lib/apply/dispatch";
import { prepareApplication } from "@/lib/apply/prepare";
import { skipApplication } from "@/lib/apply/skip";
import { noteBackgroundStart } from "@/lib/background-status";

export const maxDuration = 60;

const Body = z.object({ action: z.enum(["prepare", "approve", "skip"]), ids: z.array(z.string().uuid()).min(1).max(50) });

/**
 * Do one thing to many rows at once (the checkboxes on Jobs and Applications):
 *  - prepare: write the resume, cover letter (and email) for the selected matched jobs, in the background on GitHub
 *  - approve: approve the selected applications under the normal rules; automatic ones are sent from the cloud in one batch
 *  - skip: skip the selected applications
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Select between 1 and 50 rows." }, { status: 400 });
  const { action, ids } = parsed.data;

  if (action === "prepare") {
    if (workerConfigured()) {
      const err = await dispatchWorkflow("task.yml", { task: "prepare_many", job_ids: ids.join(",") });
      if (err) return NextResponse.json({ error: `GitHub did not start it: ${err}` }, { status: 502 });
      await noteBackgroundStart("prepare");
      await logActivity({ kind: "schedule.changed", message: `Preparing ${ids.length} application(s) started in the background (from the site)`, status: "dispatched", detail: { where: "github-actions", jobs: ids.length } }).catch(() => undefined);
      return NextResponse.json({ ok: true, where: "github", note: `Preparing ${ids.length} application${ids.length === 1 ? "" : "s"} in the background (about 1 to 3 minutes each). They appear under Applications as Pending approval.` });
    }
    // without GitHub: as many as fit inside the web request, the rest are left for the next press
    const deadline = Date.now() + 45_000;
    let done = 0; const failed: string[] = [];
    for (const id of ids) {
      if (Date.now() > deadline - 15_000) break;
      try { await prepareApplication(id); done++; } catch (e) { failed.push(e instanceof Error ? e.message : String(e)); }
    }
    return NextResponse.json({ ok: true, where: "inline", note: `Prepared ${done} of ${ids.length} here${failed.length ? ` (${failed.length} failed: ${failed[0].slice(0, 120)})` : ""}.${done < ids.length ? " Connect GitHub (System health) to prepare many at once in the background." : ""}` });
  }

  if (action === "skip") {
    let done = 0;
    for (const id of ids) if (await skipApplication(id).catch(() => false)) done++;
    return NextResponse.json({ ok: true, note: `Skipped ${done} application${done === 1 ? "" : "s"}.` });
  }

  // approve
  const deadline = Date.now() + 50_000;
  let approved = 0, automated = 0, emailed = 0;
  const problems: { id: string; error: string }[] = [];
  let reached = 0;
  for (const id of ids) {
    if (Date.now() > deadline) break;
    reached++;
    const r = await approveApplication(id, { actor: "user", dispatch: false }).catch((e) => ({ ok: false as const, status: 500, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) { problems.push({ id, error: r.error }); continue; }
    approved++;
    if (r.mode === "automated") automated++;
    if (/Emailed to/.test(r.note ?? "")) emailed++;
  }
  // one batch run sends every automatic application that was approved (several single dispatches would replace each other)
  let warning: string | null = null;
  if (automated > 0) warning = workerConfigured() ? await dispatchWorkflow("apply.yml", { application_id: "" }) : "GitHub is not connected, so automatic applications will be sent by the next scheduled run.";
  const parts = [`Approved ${approved} of ${ids.length}.`];
  if (automated) parts.push(`${automated} will be sent automatically from the cloud${warning ? ` (${warning})` : ""}.`);
  if (approved - automated > 0) parts.push(`${approved - automated} wait for the assistant on your computer or for you to submit.`);
  if (emailed) parts.push(`${emailed} also emailed to the employer.`);
  if (problems.length) parts.push(`${problems.length} not approved: ${problems[0].error.slice(0, 140)}${problems.length > 1 ? " (and others)" : ""}.`);
  if (reached < ids.length) parts.push(`${ids.length - reached} not reached in time: press again for the rest.`);
  return NextResponse.json({ ok: true, note: parts.join(" "), approved, automated, problems });
}
