import "server-only";
import { withRun, type RunCtx } from "@/lib/activity";
import { jobLogFields } from "@/lib/activity-helpers";
import type { RunTrigger } from "@/lib/activity-types";
import { db, must } from "@/lib/db";
import { runStructured } from "@/lib/llm/registry";
import { loadEffectiveCountries } from "@/lib/country-config-store";
import { getProfile } from "@/lib/profile/store";
import { withLegacyFallback } from "@/lib/schema";
import { getSetting } from "@/lib/settings";
import { JobScore, roundScore } from "@/lib/types";
import { evidenceText, gatherEvidence, irrelevantReason, judge } from "./rules";
import { enrichIfThin } from "./enrich";
import { buildScorePrompt, prefilter, SCORE_SYSTEM, type JobForScoring } from "./prompt";

type JobRow = JobForScoring & { id: string; url: string; portal?: string | null; source?: string | null };

/**
 * Score new jobs newest-first until `budgetMs` is used up, inside a recorded run. Every decision is logged with its
 * reason (rejected before scoring, rejected by fit, or matched), so nothing is dropped without a trace.
 */
export async function scoreNewJobs(opts: { limit: number; budgetMs: number; trigger?: RunTrigger }) {
  return withRun({ trigger: opts.trigger ?? "manual", kind: "score", scope: { limit: opts.limit } }, (ctx) => scoreStep(ctx, opts));
}

/** The scoring step inside an existing run. `countries` limits it to a schedule's countries. */
export async function scoreStep(ctx: RunCtx, opts: { limit: number; budgetMs: number; countries?: string[] }) {
  const started = Date.now();
  const profile = await getProfile();
  if (profile.experience.length === 0) throw new Error("Profile is empty: import and confirm your resume first");
  const { threshold, min_evidence: minEvidence } = await getSetting("scoring");
  const blocklist = await getSetting("blocklist");
  const { countries, configured } = await loadEffectiveCountries();
  const countryRules = configured ? countries : undefined;

  // The pool: far more jobs than the model will see. Everything in it is judged by free rules first; only the most promising
  // few go to the model, best first, so a flood of postings can never burn the model quota and nothing waits behind newer noise.
  const pool = Math.max(opts.limit * 8, 400);
  const loaded = must<JobRow[]>(
    await (opts.countries?.length
      ? db().from("jobs").select("*").eq("status", "new").in("country", opts.countries).order("found_at", { ascending: false }).limit(pool)
      : db().from("jobs").select("*").eq("status", "new").order("found_at", { ascending: false }).limit(pool)),
    "load new jobs",
  );
  const out = { scored: 0, queued: 0, skipped: 0, failed: [] as { id: string; error: string }[], remaining: Math.max(0, loaded.length) };

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

  // 1. free rules: country/remote/pay/visa prefilter, then the evidence check against your profile
  const candidates: { job: JobRow; evidence: ReturnType<typeof gatherEvidence> }[] = [];
  for (const job of loaded) {
    if (Date.now() - started > opts.budgetMs) break;
    const ref = { ...jobLogFields(job), run_id: ctx.id };
    const reason = prefilter(job, profile, countryRules, blocklist);
    if (reason) {
      await decide(job, "skipped", reason);
      await ctx.log({ kind: "job.rejected", message: `Rejected before scoring: ${reason}`, status: "rejected", ...ref, detail: { stage: "prefilter", title: job.title, reason } });
      ctx.stat("rejected"); out.skipped++; out.remaining--;
      continue;
    }
    const evidence = gatherEvidence(profile, job);
    const irrelevant = irrelevantReason(evidence) ?? (evidence.score < minEvidence ? `Weak match on the rules (${evidence.score}, below your minimum of ${minEvidence}): the title and key terms barely overlap your profile` : null);
    if (irrelevant) {
      // no model quota is spent on a posting that has nothing to do with the profile; the reason and numbers are kept
      const detail = { score: evidence.score, matchedSkills: [], gaps: evidence.missingTerms.slice(0, 8), seniorityFit: "unknown", locationVisaFit: "unknown", salarySignal: "unknown", summary: irrelevant };
      must(await db().from("job_scores").upsert({ job_id: job.id, score: evidence.score, detail, model: "rules" }).select("job_id"), "save score");
      await decide(job, "skipped", `Fit ${evidence.score}: ${irrelevant}`);
      await ctx.log({ kind: "job.rejected", message: `Fit ${evidence.score}: ${irrelevant}`, status: "rejected", ...ref, detail: { stage: "evidence", score: evidence.score, evidence, title: job.title } });
      ctx.stat("rejected"); ctx.stat("rejected_by_rules"); out.skipped++; out.remaining--;
      continue;
    }
    candidates.push({ job, evidence });
  }

  // 2. the model sees the best candidates first, at most `limit` per run; the rest wait (still "new") for the next run
  candidates.sort((x, y) => y.evidence.score - x.evidence.score);
  let modelCalls = 0, enriched = 0;
  for (const { job, evidence } of candidates) {
    if (Date.now() - started > opts.budgetMs) break;
    if (modelCalls >= opts.limit) break;
    const ref = { ...jobLogFields(job), run_id: ctx.id };
    modelCalls++;
    if (enriched < 25) {
      const full = await enrichIfThin(job);
      if (full) { job.description = full; enriched++; ctx.stat("descriptions_completed"); }
    }
    try {
      const scored = await runStructured({ task: "score", schema: JobScore, system: SCORE_SYSTEM, prompt: buildScorePrompt(profile, job, countryRules?.find((c) => c.country === job.country?.toLowerCase()), evidenceText(evidence)), jobId: job.id });
      const model = scored.model;
      const judged = judge({ ...scored.output, score: roundScore(scored.output.score) }, evidence, profile);
      const output = { ...judged.output, score: roundScore(judged.score) };
      const stored = judged.adjusted ? { ...output, adjustments: judged.notes, modelScore: roundScore(scored.output.score), evidenceScore: evidence.score } : output;
      must(await db().from("job_scores").upsert({ job_id: job.id, score: output.score, detail: stored, model }).select("job_id"), "save score");
      const queued = output.score >= threshold;
      const reasonText = queued ? null : `Fit ${output.score} below threshold ${threshold}: ${output.summary}`;
      await decide(job, queued ? "queued" : "skipped", reasonText);
      await ctx.log(queued
        ? { kind: "job.matched", message: `Matched (fit ${output.score}): ${job.title}`, status: "matched", ...ref, detail: { stage: "fit", score: output.score, threshold, summary: output.summary, matchedSkills: output.matchedSkills, gaps: output.gaps, model, title: job.title, adjustments: judged.notes, evidenceScore: evidence.score } }
        : { kind: "job.rejected", message: reasonText!, status: "rejected", ...ref, detail: { stage: "fit", score: output.score, threshold, summary: output.summary, gaps: output.gaps, model, title: job.title, adjustments: judged.notes, evidenceScore: evidence.score } });
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
}
