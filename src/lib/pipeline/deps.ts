import "server-only";
import { approveApplication } from "@/lib/apply/approve";
import { prepareApplication } from "@/lib/apply/prepare";
import { loadCapState } from "@/lib/apply/state";
import { db, must } from "@/lib/db";
import { scanStep } from "@/lib/jobs/discover";
import type { ApplyType } from "@/lib/jobs/normalize";
import { scoreStep } from "@/lib/score/run";
import { getSetting } from "@/lib/settings";
import type { PipelineDeps, QueuedJob } from "./run";

type QueuedRow = { id: string; title: string; company: string; country: string | null; portal: string | null; source: string | null; apply_type: ApplyType; job_scores: { score: number } | { score: number }[] | null };

/** The real database, model and portal implementations of the pipeline's steps. */
export function liveDeps(): PipelineDeps {
  return {
    scan: async (ctx, scope) => { await scanStep(ctx, { countries: scope.countries, integrations: scope.integrations, budgetMs: scope.budgetMs }); },
    score: async (ctx, scope) => {
      const r = await scoreStep(ctx, { limit: 60, budgetMs: scope.budgetMs, countries: scope.countries });
      return { scored: r.scored, queued: r.queued, skipped: r.skipped, failed: r.failed.length };
    },
    queuedJobs: async (countries) => {
      const base = db().from("jobs").select("id,title,company,country,portal,source,apply_type,job_scores(score)").eq("status", "queued");
      const rows = must<QueuedRow[]>(await (countries.length ? base.in("country", countries) : base).limit(300), "load queued jobs");
      return rows.map<QueuedJob>((r) => {
        const sc = Array.isArray(r.job_scores) ? r.job_scores[0] : r.job_scores;
        return { id: r.id, title: r.title, company: r.company, country: r.country, portal: r.portal ?? r.source?.split(":")[0] ?? null, apply_type: r.apply_type, score: sc?.score ?? 0 };
      });
    },
    failedPrepareAttempts: async (jobId) =>
      (await db().from("activity_log").select("id", { count: "exact", head: true }).eq("kind", "application.prepare_failed").eq("status", "failed").eq("job_id", jobId)).count ?? 0,
    prepare: (jobId, runId) => prepareApplication(jobId, runId),
    approve: (applicationId, runId) => approveApplication(applicationId, { actor: "schedule", runId, dispatch: false }),
    loadCaps: async () => ({ caps: await getSetting("caps"), state: await loadCapState() }),
    now: () => Date.now(),
  };
}
