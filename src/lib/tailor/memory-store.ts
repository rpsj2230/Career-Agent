import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { CoverLetter, TailoredResume } from "@/lib/types";
import type { Library, PastResume } from "./memory";

type Row = Record<string, unknown>;

/**
 * Resumes the agent made before that passed verification, with the job each was for and how that application went.
 * Only the newest version per job; the job being prepared is excluded. A database that has not been updated just
 * means there is no memory yet.
 */
export async function loadPastResumes(excludeJobId: string, limit = 300): Promise<PastResume[]> {
  const docs = await db().from("documents").select("job_id,content,verification,created_at, job:jobs(title,company,description,country)").eq("kind", "resume").order("created_at", { ascending: false }).limit(limit);
  if (docs.error) return [];
  const newest = new Map<string, Row>();
  for (const d of docs.data as Row[]) {
    const v = d.verification as { ok?: boolean } | null;
    if (d.job_id === excludeJobId || v?.ok !== true || newest.has(String(d.job_id))) continue;
    newest.set(String(d.job_id), d);
  }
  if (newest.size === 0) return [];
  const ids = [...newest.keys()];
  const apps = await db().from("applications").select("job_id,lifecycle,cover_doc_id").in("job_id", ids);
  const appBy = new Map(((apps.data ?? []) as Row[]).map((a) => [String(a.job_id), a]));
  const coverIds = [...appBy.values()].map((a) => a.cover_doc_id).filter(Boolean) as string[];
  const covers = coverIds.length ? await db().from("documents").select("id,content,verification").in("id", coverIds) : { data: [] as Row[] };
  const coverBy = new Map(((covers.data ?? []) as Row[]).map((c) => [String(c.id), c]));

  const out: PastResume[] = [];
  for (const [jobId, d] of newest) {
    const job = (Array.isArray(d.job) ? d.job[0] : d.job) as { title?: string; company?: string; description?: string; country?: string | null } | null;
    const content = TailoredResume.safeParse(d.content);
    if (!job?.title || !content.success) continue;
    const app = appBy.get(jobId);
    const cd = app?.cover_doc_id ? coverBy.get(String(app.cover_doc_id)) : undefined;
    const cover = cd && (cd.verification as { ok?: boolean } | null)?.ok === true ? CoverLetter.safeParse(cd.content) : null;
    out.push({
      jobId, title: job.title, company: job.company ?? "", description: job.description ?? "", country: job.country ?? null,
      content: content.data, lifecycle: String(app?.lifecycle ?? "none"), createdAt: String(d.created_at), cover: cover?.success ? cover.data : null,
    });
  }
  return out;
}

export async function loadLibrary(excludeJobId: string): Promise<Library> {
  const t = await getSetting("tailoring");
  if (!t.reuse_enabled) return { past: [], enabled: false };
  return { past: await loadPastResumes(excludeJobId), enabled: true, thresholds: { reuse: t.reuse_similarity, adapt: t.adapt_similarity } };
}
