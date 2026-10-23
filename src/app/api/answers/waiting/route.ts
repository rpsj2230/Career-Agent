import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { answerWaitingQuestions } from "@/lib/apply/answer-waiting";
import { dispatchWorkflow, workerConfigured } from "@/lib/apply/dispatch";

export const maxDuration = 60;

/** "Let the AI answer these": started on GitHub (hosted models first, the local model when they fail); a short version runs here when GitHub is not connected. */
export async function POST() {
  if (workerConfigured()) {
    const err = await dispatchWorkflow("task.yml", { task: "answer_waiting" });
    if (!err) {
      await logActivity({ kind: "config.changed", message: "Answering the waiting questions started in the background", status: "dispatched", detail: { where: "github-actions" } }).catch(() => undefined);
      return NextResponse.json({ ok: true, where: "github", note: "Started on GitHub. Allow 5 to 15 minutes, then reload: answered questions disappear from this list and their applications go back to the assistant's queue." });
    }
  }
  const r = await answerWaitingQuestions({ budgetMs: 45_000, sequential: false });
  return NextResponse.json({ ok: true, where: "inline", note: `${r.answered} question(s) answered, ${r.requeued} application(s) back in the queue, ${r.left.length} left for you.` });
}
