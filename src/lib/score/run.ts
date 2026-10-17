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
import { BatchScore, JobScore, roundScore } from "@/lib/types";
import { evidenceText, gatherEvidence, irrelevantReason, judge } from "./rules";
import { enrichIfThin } from "./enrich";
import { outcomeBias } from "./learning";
import { loadOutcomeStats } from "./learning-store";
import { BATCH_SYSTEM_SUFFIX, buildBatchPrompt, buildScorePrompt, prefilter, SCORE_SYSTEM, type JobForScoring } from "./prompt";

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
  const scoring = await getSetting("scoring");
  const { threshold, min_evidence: minEvidence } = scoring;
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
  type Candidate = { job: JobRow; evidence: ReturnType<typeof gatherEvidence> };
  const candidates: Candidate[] = [];
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

  // 2. the model sees the best candidates first, at most `limit` per run; the rest wait (still "new") for the next run.
  //    Several jobs of the same country share one request, so the candidate's profile is not paid for again for each job.
  candidates.sort((x, y) => y.evidence.score - x.evidence.score);
  const size = Math.max(1, Math.min(8, scoring.batch_size ?? 1));
  const stats = scoring.learning === false ? new Map() : await loadOutcomeStats().catch(() => new Map());
  const queue = candidates.slice(0, opts.limit);
  const critFor = (j: JobRow) => countryRules?.find((c) => c.country === j.country?.toLowerCase());
  let enriched = 0;

  type Scored = { output: JobScore; model: string; tier: "fast" | "strong" };
  const scoreOne = (c: Candidate): Promise<Scored> =>
    runStructured({ task: "score", schema: JobScore, system: SCORE_SYSTEM, prompt: buildScorePrompt(profile, c.job, critFor(c.job), evidenceText(c.evidence)), jobId: c.job.id });
  const fail = async (c: Candidate, e: unknown) => {
    // leave the job as 'new' so the next run retries it
    const error = e instanceof Error ? e.message : String(e);
    out.failed.push({ id: c.job.id, error });
    ctx.stat("failed");
    await ctx.log({ kind: "job.score_failed", level: "error", message: `Could not score "${c.job.title}": ${error}`, status: "failed", ...{ ...jobLogFields(c.job), run_id: ctx.id }, detail: { error, title: c.job.title } });
    return /No model available|All models failed/.test(error);
  };

  const finish = async (c: Candidate, r: Scored) => {
    const { job, evidence } = c;
    const ref = { ...jobLogFields(job), run_id: ctx.id };
    let { output: raw, model } = r;
    let judged = judge({ ...raw, score: roundScore(raw.score) }, evidence, profile);
    // a score close to the threshold decides whether you see the job: have a stronger model look again before settling it
    if (scoring.escalate_borderline !== false && r.tier === "fast" && Math.abs(judged.score - threshold) <= 8) {
      try {
        const again = await runStructured({ task: "score", schema: JobScore, system: SCORE_SYSTEM, prompt: buildScorePrompt(profile, job, critFor(job), evidenceText(evidence)), jobId: job.id, prefer: "strong" });
        if (again.tier === "strong") { raw = again.output; model = again.model; judged = judge({ ...raw, score: roundScore(raw.score) }, evidence, profile); judged.notes.push(`Re-checked by a stronger model (${model}) because the score was close to your threshold`); ctx.stat("escalated"); }
      } catch { /* the first answer stands */ }
    }
    // what happened to similar jobs before nudges the ranking a little (bounded, and always shown)
    const learned = outcomeBias(job, stats);
    let score = judged.score;
    const notes = [...judged.notes];
    if (learned.bias !== 0) { score = roundScore(score + learned.bias); notes.push(`Adjusted ${learned.bias > 0 ? "+" : ""}${learned.bias} from your past decisions: ${learned.why.join("; ")}`); ctx.stat("learned_adjustments"); }
    const output = { ...judged.output, score };
    const stored = notes.length ? { ...output, adjustments: notes, modelScore: roundScore(raw.score), evidenceScore: evidence.score } : output;
    must(await db().from("job_scores").upsert({ job_id: job.id, score: output.score, detail: stored, model }).select("job_id"), "save score");
    const queued = output.score >= threshold;
    const reasonText = queued ? null : `Fit ${output.score} below threshold ${threshold}: ${output.summary}`;
    await decide(job, queued ? "queued" : "skipped", reasonText);
    await ctx.log(queued
      ? { kind: "job.matched", message: `Matched (fit ${output.score}): ${job.title}`, status: "matched", ...ref, detail: { stage: "fit", score: output.score, threshold, summary: output.summary, matchedSkills: output.matchedSkills, gaps: output.gaps, model, title: job.title, adjustments: notes, evidenceScore: evidence.score } }
      : { kind: "job.rejected", message: reasonText!, status: "rejected", ...ref, detail: { stage: "fit", score: output.score, threshold, summary: output.summary, gaps: output.gaps, model, title: job.title, adjustments: notes, evidenceScore: evidence.score } });
    ctx.stat("scored"); ctx.stat(queued ? "matched" : "rejected");
    out.scored++; out.remaining--;
    if (queued) out.queued++; else out.skipped++;
  };

  let stop = false;
  while (queue.length && !stop) {
    if (Date.now() - started > opts.budgetMs) break;
    const first = queue.shift()!;
    const batch = [first];
    for (let i = 0; i < queue.length && batch.length < size;) { if (queue[i].job.country === first.job.country) batch.push(...queue.splice(i, 1)); else i++; }
    for (const c of batch) {
      if (enriched >= 25) break;
      const full = await enrichIfThin(c.job);
      if (full) { c.job.description = full; enriched++; ctx.stat("descriptions_completed"); }
    }

    const results = new Map<string, Scored>();
    if (batch.length > 1) {
      try {
        const res = await runStructured({ task: "score", schema: BatchScore, system: SCORE_SYSTEM + BATCH_SYSTEM_SUFFIX, prompt: buildBatchPrompt(profile, batch.map((c) => ({ id: c.job.id, job: c.job, evidence: evidenceText(c.evidence) })), critFor(first.job)), jobId: first.job.id });
        ctx.stat("model_calls"); ctx.stat("jobs_in_batches", batch.length);
        for (const item of res.output.results) if (batch.some((c) => c.job.id === item.id) && !results.has(item.id)) results.set(item.id, { output: item, model: res.model, tier: res.tier });
      } catch (e) {
        if (/No model available|All models failed/.test(e instanceof Error ? e.message : String(e))) { for (const c of batch) await fail(c, e); ctx.markPartial(e instanceof Error ? e.message : String(e)); break; }
        /* a bad batch answer: every job is scored on its own below */
      }
    }
    for (const c of batch) {
      let r = results.get(c.job.id);
      try {
        if (!r) { r = await scoreOne(c); ctx.stat("model_calls"); }
        await finish(c, r);
      } catch (e) {
        if (await fail(c, e)) { ctx.markPartial(e instanceof Error ? e.message : String(e)); stop = true; break; }
      }
    }
  }
  if (out.failed.length) ctx.markPartial(`${out.failed.length} job(s) could not be scored`);
  return out;
}
