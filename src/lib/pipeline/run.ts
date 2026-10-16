import { heartbeat, withRun, type RunCtx } from "@/lib/activity";
import type { ActivityStore } from "@/lib/activity-store";
import type { RunTrigger } from "@/lib/activity-types";
import type { ApproveResult } from "@/lib/apply/approve";
import type { CapState } from "@/lib/apply/caps";
import { decideAutoApply } from "@/lib/apply/policy";
import type { ApplyType } from "@/lib/jobs/normalize";
import type { ScheduleConfig } from "@/lib/schedule";
import type { Caps } from "@/lib/settings";

export type QueuedJob = { id: string; title: string; company: string; country: string | null; portal: string | null; apply_type: ApplyType; score: number };

/** Everything the pipeline needs from the outside world, so its decisions can be tested without a database or models. */
export type PipelineDeps = {
  scan(ctx: RunCtx, scope: { countries: string[]; integrations: string[]; budgetMs: number }): Promise<void>;
  score(ctx: RunCtx, scope: { countries: string[]; budgetMs: number }): Promise<{ scored: number; queued: number; skipped: number; failed: number }>;
  queuedJobs(countries: string[]): Promise<QueuedJob[]>;
  failedPrepareAttempts(jobId: string): Promise<number>;
  prepare(jobId: string, runId: string | null): Promise<{ applicationId: string; verified: boolean }>;
  approve(applicationId: string, runId: string | null): Promise<ApproveResult>;
  loadCaps(): Promise<{ caps: Caps; state: CapState }>;
  now(): number;
  store?: ActivityStore;
};

/** A job whose preparation has failed this many times is left alone until you look at it. */
export const MAX_PREPARE_ATTEMPTS = 3;

export type PipelineSummary = {
  runId: string | null;
  inserted: number; scored: number; matched: number; prepared: number; prepareFailed: number;
  autoApproved: number; manualRequired: number; awaitingApproval: number; blocked: number;
  /** automated applications now waiting for the apply worker */
  readyToSubmit: number;
  timedOut: boolean;
  /** some step failed or was cut short; the run is recorded as partial */
  partial: boolean;
};

/**
 * One scheduled run: find jobs, score them, prepare applications, and (only if the schedule allows it) approve them.
 * Each step is recorded, a failing step marks the run partial instead of discarding the others, and anything not
 * finished within the time budget is simply picked up by the next run (nothing is lost or half-applied).
 */
export async function runPipeline(
  schedule: Pick<ScheduleConfig, "countries" | "integrations" | "mode" | "require_approval" | "max_prepare" | "max_apply"> & { id: string; name: string },
  deps: PipelineDeps,
  o: { trigger: RunTrigger; budgetMs?: number },
): Promise<PipelineSummary> {
  const budgetMs = o.budgetMs ?? 40 * 60_000;
  const started = deps.now();
  const left = () => Math.max(0, budgetMs - (deps.now() - started));
  const out: PipelineSummary = { runId: null, inserted: 0, scored: 0, matched: 0, prepared: 0, prepareFailed: 0, autoApproved: 0, manualRequired: 0, awaitingApproval: 0, blocked: 0, readyToSubmit: 0, timedOut: false, partial: false };

  await withRun({ trigger: o.trigger, kind: "pipeline", schedule_id: schedule.id, scope: { schedule: schedule.name, mode: schedule.mode, countries: schedule.countries, integrations: schedule.integrations } }, async (rc) => {
    out.runId = rc.id;
    const ctx: RunCtx = { ...rc, markPartial: (reason) => { out.partial = true; rc.markPartial(reason); } };

    // 1. find jobs. A failing source never stops the rest of the run.
    try { await deps.scan(ctx, { countries: schedule.countries, integrations: schedule.integrations, budgetMs: Math.min(left(), 10 * 60_000) }); }
    catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      ctx.markPartial(`Searching failed: ${error}`);
      await ctx.log({ kind: "scan.failed", level: "error", message: `Searching failed: ${error}`, status: "failed", detail: { error } });
    }
    out.inserted = ctx.stats.inserted ?? 0;
    await heartbeat(ctx.id, deps.store);

    // 2. score everything waiting, including a backlog left by an earlier run
    try {
      const r = await deps.score(ctx, { countries: schedule.countries, budgetMs: Math.min(left(), 15 * 60_000) });
      out.scored = r.scored; out.matched = r.queued;
      if (r.failed) ctx.markPartial(`${r.failed} job(s) could not be scored; they will be retried next run`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      ctx.markPartial(`Scoring failed: ${error}`);
      await ctx.log({ kind: "job.score_failed", level: "error", message: `Scoring stopped: ${error}`, status: "failed", detail: { error } });
    }
    await heartbeat(ctx.id, deps.store);
    if (schedule.mode === "scan") return;

    // 3. prepare applications for the best matches first
    const candidates = (await deps.queuedJobs(schedule.countries)).sort((a, b) => b.score - a.score);
    const prepared: { applicationId: string; verified: boolean; job: QueuedJob }[] = [];
    for (const job of candidates) {
      if (prepared.length >= schedule.max_prepare) break;
      if (left() < 90_000) { out.timedOut = true; ctx.markPartial("Time limit reached before every match was prepared; the rest will be prepared next run"); break; }
      const ref = { job_id: job.id, company: job.company, country: job.country, portal: job.portal };
      if ((await deps.failedPrepareAttempts(job.id)) >= MAX_PREPARE_ATTEMPTS) {
        await ctx.log({ kind: "application.prepare_failed", level: "warn", message: `Not retrying "${job.title}": preparation failed ${MAX_PREPARE_ATTEMPTS} times already`, status: "gave_up", ...ref, detail: { title: job.title } });
        continue;
      }
      try {
        const r = await deps.prepare(job.id, ctx.id);
        prepared.push({ ...r, job });
        ctx.stat("prepared"); out.prepared++;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        out.prepareFailed++; ctx.stat("prepare_failed");
        await ctx.log({ kind: "application.prepare_failed", level: "error", message: `Could not prepare "${job.title}" at ${job.company}: ${error}`, status: "failed", ...ref, detail: { error, title: job.title } });
        if (/No model available|All models failed/.test(error)) { ctx.markPartial(error); break; } // no model can work on the rest either
      }
      await heartbeat(ctx.id, deps.store);
    }
    if (out.prepareFailed) ctx.markPartial(`${out.prepareFailed} application(s) could not be prepared; the jobs stay queued and are retried next run`);

    // 4. approve, only within what this schedule is allowed to do
    let automated = 0;
    for (const p of prepared) {
      const { caps, state } = await deps.loadCaps();
      const d = decideAutoApply({ mode: schedule.mode, requireApproval: schedule.require_approval, verified: p.verified, applyType: p.job.apply_type, caps, capState: state, automatedThisRun: automated, maxApply: schedule.max_apply });
      if (d.action === "leave") { out.awaitingApproval++; ctx.stat(`left_${d.code}`); continue; }
      const r = await deps.approve(p.applicationId, ctx.id);
      if (!r.ok) { out.blocked++; ctx.stat("approval_blocked"); ctx.markPartial(`An approval was refused: ${r.error}`); continue; }
      if (r.mode === "automated") { automated++; out.autoApproved++; out.readyToSubmit++; ctx.stat("auto_approved"); }
      else { out.manualRequired++; ctx.stat("manual_required"); }
    }
  }, deps.store);
  return out;
}

/** The Telegram message after a scheduled run: what happened and what is waiting for you. */
export function pipelineSummaryText(name: string, s: PipelineSummary, appUrl?: string): string {
  const lines = [
    `Career Agent: ${name}`,
    `New jobs found: ${s.inserted} · scored: ${s.scored} · matched: ${s.matched}`,
    `Applications prepared: ${s.prepared}${s.prepareFailed ? ` (${s.prepareFailed} failed)` : ""}`,
  ];
  if (s.awaitingApproval) lines.push(`Waiting for your approval: ${s.awaitingApproval}`);
  if (s.readyToSubmit) lines.push(`Submitting automatically: ${s.readyToSubmit}`);
  if (s.manualRequired) lines.push(`Need you to press submit: ${s.manualRequired}`);
  if (s.blocked) lines.push(`Approvals refused: ${s.blocked}`);
  if (s.timedOut) lines.push("Stopped at the time limit; the rest continues next run");
  if (appUrl) lines.push(`Open: ${appUrl}${s.runId ? `/logs/runs/${s.runId}` : "/applications"}`);
  return lines.join("\n");
}
