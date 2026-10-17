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

type QueuedRow = { id: string; title: string; company: string; country: string | null; posted_at?: string | null; url?: string; portal: string | null; source: string | null; apply_type: ApplyType; job_scores: { score: number } | { score: number }[] | null };

/** The real database, model and portal implementations of the pipeline's steps. */
export function liveDeps(): PipelineDeps {
  return {
    scan: async (ctx, scope) => { await scanStep(ctx, { countries: scope.countries, integrations: scope.integrations, budgetMs: scope.budgetMs }); },
    score: async (ctx, scope) => {
      const r = await scoreStep(ctx, { limit: 60, budgetMs: scope.budgetMs, countries: scope.countries });
      return { scored: r.scored, queued: r.queued, skipped: r.skipped, failed: r.failed.length };
    },
    queuedJobs: async (countries) => {
      const base = db().from("jobs").select("id,title,company,country,portal,source,apply_type,posted_at,url,job_scores(score)").eq("status", "queued");
      const rows = must<QueuedRow[]>(await (countries.length ? base.in("country", countries) : base).limit(300), "load queued jobs");
      return rows.map<QueuedJob>((r) => {
        const sc = Array.isArray(r.job_scores) ? r.job_scores[0] : r.job_scores;
        return { id: r.id, title: r.title, company: r.company, country: r.country, portal: r.portal ?? r.source?.split(":")[0] ?? null, apply_type: r.apply_type, score: sc?.score ?? 0, posted_at: r.posted_at ?? null, url: r.url };
      });
    },
    failedPrepareAttempts: async (jobId) =>
      (await db().from("activity_log").select("id", { count: "exact", head: true }).eq("kind", "application.prepare_failed").eq("status", "failed").eq("job_id", jobId)).count ?? 0,
    requeued: async (countries) => {
      const ev = must<{ application_id: string }[]>(await db().from("apply_events").select("application_id").eq("kind", "answer_added").order("at", { ascending: false }).limit(100), "load re-queued applications");
      const ids = [...new Set(ev.map((e) => e.application_id))];
      if (!ids.length) return [];
      const apps = must<{ id: string; resume_doc_id: string | null; cover_doc_id: string | null; country: string | null; job: QueuedRow | QueuedRow[] | null }[]>(
        await db().from("applications").select("id,resume_doc_id,cover_doc_id,country,job:jobs(id,title,company,country,portal,source,apply_type,job_scores(score))").in("id", ids).eq("status", "prepared"), "load re-queued applications");
      const out: { applicationId: string; verified: boolean; job: QueuedJob }[] = [];
      for (const a of apps) {
        const r = Array.isArray(a.job) ? a.job[0] : a.job;
        if (!r || (countries.length && r.country && !countries.includes(r.country))) continue;
        const docIds = [a.resume_doc_id, a.cover_doc_id].filter(Boolean) as string[];
        const docs = docIds.length ? must<{ verification: { ok: boolean } | null }[]>(await db().from("documents").select("verification").in("id", docIds), "load documents") : [];
        const sc = Array.isArray(r.job_scores) ? r.job_scores[0] : r.job_scores;
        out.push({ applicationId: a.id, verified: docs.length > 0 && docs.every((d) => d.verification?.ok === true), job: { id: r.id, title: r.title, company: r.company, country: r.country, portal: r.portal ?? r.source?.split(":")[0] ?? null, apply_type: r.apply_type, score: sc?.score ?? 0 } });
      }
      return out;
    },
    prepare: (jobId, runId) => prepareApplication(jobId, runId),
    approve: (applicationId, runId) => approveApplication(applicationId, { actor: "schedule", runId, dispatch: false }),
    loadCaps: async () => ({ caps: await getSetting("caps"), state: await loadCapState() }),
    now: () => Date.now(),
  };
}
