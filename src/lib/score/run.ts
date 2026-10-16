import "server-only";
import { db, must } from "@/lib/db";
import { runStructured } from "@/lib/llm/registry";
import { getProfile } from "@/lib/profile/store";
import { getSetting } from "@/lib/settings";
import { JobScore } from "@/lib/types";
import { buildScorePrompt, prefilter, SCORE_SYSTEM, type JobForScoring } from "./prompt";

type JobRow = JobForScoring & { id: string };

/** Score new jobs newest-first until `budgetMs` is used up. Safe to call repeatedly. */
export async function scoreNewJobs(opts: { limit: number; budgetMs: number }) {
  const started = Date.now();
  const profile = await getProfile();
  if (profile.experience.length === 0) throw new Error("Profile is empty: import and confirm your resume first");
  const { threshold } = await getSetting("scoring");

  const jobs = must<JobRow[]>(
    await db().from("jobs").select("id,title,company,country,location,description,salary_text").eq("status", "new").order("found_at", { ascending: false }).limit(opts.limit),
    "load new jobs",
  );
  const out = { scored: 0, queued: 0, skipped: 0, failed: [] as { id: string; error: string }[], remaining: Math.max(0, jobs.length) };

  for (const job of jobs) {
    if (Date.now() - started > opts.budgetMs) break;
    const reason = prefilter(job, profile);
    if (reason) {
      must(await db().from("jobs").update({ status: "skipped", skip_reason: reason }).eq("id", job.id).select("id"), "skip job");
      out.skipped++; out.remaining--;
      continue;
    }
    try {
      const { output, model } = await runStructured({
        task: "score", schema: JobScore, system: SCORE_SYSTEM, prompt: buildScorePrompt(profile, job), jobId: job.id,
      });
      must(await db().from("job_scores").upsert({ job_id: job.id, score: output.score, detail: output, model }).select("job_id"), "save score");
      const queued = output.score >= threshold;
      must(
        await db().from("jobs").update({ status: queued ? "queued" : "skipped", skip_reason: queued ? null : `Fit ${output.score} below threshold ${threshold}: ${output.summary}` }).eq("id", job.id).select("id"),
        "update job status",
      );
      out.scored++; out.remaining--;
      if (queued) out.queued++; else out.skipped++;
    } catch (e) {
      // leave the job as 'new' so the next run retries it; stop early if no model is usable at all
      const error = e instanceof Error ? e.message : String(e);
      out.failed.push({ id: job.id, error });
      if (/No model available|All models failed/.test(error)) break;
    }
  }
  return out;
}
