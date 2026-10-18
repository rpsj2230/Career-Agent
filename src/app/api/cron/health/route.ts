import { NextResponse } from "next/server";
import { dispatchWorkflow, workerConfigured } from "@/lib/apply/dispatch";
import { alertOnce } from "@/lib/alerts";
import { logActivity } from "@/lib/activity";
import { automationHealth, lastTick } from "@/lib/automation-health";
import { healKeys } from "@/lib/llm/keys";

export const maxDuration = 30;

/**
 * Daily backup watcher, started by Vercel's own scheduler (independent of GitHub's clock, which can run late or skip).
 * It tells you by Telegram if anything on the automation checklist has failed, saves the model keys' second copy, and, if the hourly
 * GitHub check has been silent for over 3 hours while GitHub can be started, starts the scheduled pipeline itself.
 */
export async function GET() {
  const healed = await healKeys().catch(() => 0);
  const { checks, status } = await automationHealth();
  const bad = checks.filter((c) => c.status === "fail");
  let alerted = false;
  if (bad.length) alerted = await alertOnce("automation-health", 20, `Career Agent: automation needs attention.\n${bad.map((c) => `- ${c.label}: ${c.detail}${c.fix ? `\n  Fix: ${c.fix}` : ""}`).join("\n")}`).catch(() => false);

  let backup: string | null = null;
  const tick = await lastTick().catch(() => null);
  if (workerConfigured() && (!tick || Date.now() - new Date(tick).getTime() > 3 * 3_600_000)) {
    const err = await dispatchWorkflow("pipeline.yml", {});
    backup = err ?? "started the scheduled pipeline (the hourly check had been silent for over 3 hours)";
    await logActivity({ kind: "schedule.changed", message: `Backup check: ${backup}`, status: err ? "failed" : "dispatched", detail: { lastTick: tick } }).catch(() => undefined);
  }
  return NextResponse.json({ status, failing: bad.map((c) => c.id), alerted, healedKeys: healed, backup });
}
