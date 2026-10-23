import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { dispatchWorkflow, workerConfigured } from "@/lib/apply/dispatch";
import { draftInterviewAnswers } from "@/lib/autofill/draft-answers";

export const maxDuration = 60;

/**
 * "Write the interview answers from my profile". With GitHub connected the writing runs there (task.yml): no time limit, and the local model
 * is started on that machine when the hosted models are failing, which the website itself cannot do. Otherwise a short version runs here.
 */
export async function POST() {
  let why = "";
  if (workerConfigured()) {
    const err = await dispatchWorkflow("task.yml", { task: "write_answers" });
    if (!err) {
      await logActivity({ kind: "config.changed", message: "Writing the interview answers started in the background", status: "dispatched", detail: { where: "github-actions" } }).catch(() => undefined);
      return NextResponse.json({ ok: true, where: "github", written: 0, note: "Started on GitHub. If the free AI models are out of tokens it starts the local model, which takes about 5 to 15 minutes. Reload the Answer bank below then; the answers appear there for you to read and edit." });
    }
    why = `GitHub did not start it (${err}). `;
  }
  const r = await draftInterviewAnswers({ budgetMs: 50_000, sequential: false });
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true, where: "inline", ...r, note: `${why}${r.note}` });
}
