import "server-only";
import { withRun } from "@/lib/activity";
import { jobLogFields } from "@/lib/activity-helpers";
import type { RunTrigger } from "@/lib/activity-types";
import { db, must } from "@/lib/db";
import { runStructured } from "@/lib/llm/registry";
import { loadEffectiveCountries } from "@/lib/country-config-store";
import { getProfile } from "@/lib/profile/store";
import { withLegacyFallback } from "@/lib/schema";
import { getSetting } from "@/lib/settings";
import { JobScore } from "@/lib/types";
import { buildScorePrompt, prefilter, SCORE_SYSTEM, type JobForScoring } from "./prompt";

type JobRow = JobForScoring & { id: string; portal?: string | null; source?: string | null };

/**
 * Score new jobs newest-first until `budgetMs` is used up, inside a recorded run. Every decision is logged with its
 * reason (rejected before scoring, rejected by fit, or matched), so nothing is dropped without a trace.
 */
export async function scoreNewJobs(opts: { limit: number; budgetMs: number; trigger?: RunTrigger }) {
  return withRun({ trigger: opts.trigger ?? "manual", kind: "score", scope: { limit: opts.limit } }, async (ctx) => {
    const started = Date.now();
    const profile = await getProfile();
    if (profile.experience.length === 0) throw new Error("Profile is empty: import and confirm your resume first");
    const { threshold } = await getSetting("scoring");
    const { countries, configured } = await loadEffectiveCountries();
    const countryRules = configured ? countries : undefined;

    const jobs = must<JobRow[]>(
      await db().from("jobs").select("*").eq("status", "new").order("found_at", { ascending: false }).limit(opts.limit),
      "load new jobs",
    );
    const out = { scored: 0, queued: 0, skipped: 0, failed: [] as { id: string; error: string }[], remaining: Math.max(0, jobs.length) };

    const decide = async (job: JobRow, status: "queued" | "skipped", reason: string | null) => {
      const now = new Date().toISOString();
      must(
        await withLegacyFallback(
          () => db().from("jobs").update({ status, skip_reason: reason, decided_at: now }).eq("id", job.id).select("id"),
          () => db().from("jobs").update({ status, skip_reason: reason }).eq("id", job.id).select("id"),
        ),
        "update job status",
      );
    };

    for (const job of jobs) {
      if (Date.now() - started > opts.budgetMs) break;
      const ref = { ...jobLogFields(job), run_id: ctx.id };
      const reason = prefilter(job, profile, countryRules);
      if (reason) {
        await decide(job, "skipped", reason);
        await ctx.log({ kind: "job.rejected", message: `Rejected before scoring: ${reason}`, status: "rejected", ...ref, detail: { stage: "prefilter", title: job.title, reason } });
        ctx.stat("rejected"); out.skipped++; out.remaining--;
        continue;
      }
      try {
        const { output, model } = await runStructured({ task: "score", schema: JobScore, system: SCORE_SYSTEM, prompt: buildScorePrompt(profile, job, countryRules?.find((c) => c.country === job.country?.toLowerCase())), jobId: job.id });
        must(await db().from("job_scores").upsert({ job_id: job.id, score: output.score, detail: output, model }).select("job_id"), "save score");
        const queued = output.score >= threshold;
        const reasonText = queued ? null : `Fit ${output.score} below threshold ${threshold}: ${output.summary}`;
        await decide(job, queued ? "queued" : "skipped", reasonText);
        await ctx.log(queued
          ? { kind: "job.matched", message: `Matched (fit ${output.score}): ${job.title}`, status: "matched", ...ref, detail: { stage: "fit", score: output.score, threshold, summary: output.summary, matchedSkills: output.matchedSkills, gaps: output.gaps, model, title: job.title } }
          : { kind: "job.rejected", message: reasonText!, status: "rejected", ...ref, detail: { stage: "fit", score: output.score, threshold, summary: output.summary, gaps: output.gaps, model, title: job.title } });
        ctx.stat("scored"); ctx.stat(queued ? "matched" : "rejected");
        out.scored++; out.remaining--;
        if (queued) out.queued++; else out.skipped++;
      } catch (e) {
        // leave the job as 'new' so the next run retries it; stop early if no model is usable at all
        const error = e instanceof Error ? e.message : String(e);
        out.failed.push({ id: job.id, error });
        ctx.stat("failed");
        await ctx.log({ kind: "job.score_failed", level: "error", message: `Could not score "${job.title}": ${error}`, status: "failed", ...ref, detail: { error, title: job.title } });
        if (/No model available|All models failed/.test(error)) { ctx.markPartial(error); break; }
      }
    }
    if (out.failed.length) ctx.markPartial(`${out.failed.length} job(s) could not be scored`);
    return out;
  });
}
