import { db, must } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { parseAppFilters, APP_STATUS_LABEL, APP_STATUSES } from "@/lib/filters";
import { portalLabel } from "@/lib/jobs/portal";
import { isMissingSchemaError } from "@/lib/schema";

type Row = {
  status: string; method: string | null; lifecycle: string; submitted_at: string | null; approved_at: string | null; created_at: string; error: string | null; notes: string | null;
  job: { title: string; company: string; country: string | null; url: string; source: string; apply_type: string; portal?: string | null; found_at?: string; job_scores: { score: number } | { score: number }[] | null } | null;
  resume: { version: number; model: string | null; storage_path: string | null } | null;
};

/** CSV of applications, honouring the same status, portal, country and search filters as the Applications screen. */
export async function GET(request: Request) {
  const f = parseAppFilters(Object.fromEntries(new URL(request.url).searchParams));
  const build = (withPortal: boolean) => {
    let q = db().from("applications").select(
      `status,method,lifecycle,submitted_at,approved_at,created_at,error,notes, job:jobs!inner(title,company,country,url,source,apply_type,found_at${withPortal ? ",portal" : ""},job_scores(score)), resume:documents!applications_resume_doc_id_fkey(version,model,storage_path)`,
    );
    const statuses = APP_STATUSES[f.status].statuses;
    if (statuses) q = q.in("status", statuses);
    if (withPortal && f.portal) q = q.eq("job.portal", f.portal);
    if (f.country) q = q.eq("job.country", f.country);
    if (f.q) q = q.or(`title.ilike.%${f.q}%,company.ilike.%${f.q}%`, { referencedTable: "job" });
    return q.order("created_at", { ascending: false });
  };
  let res = await build(true);
  if (res.error && isMissingSchemaError(res.error.message)) res = await build(false);
  const rows = must<Row[]>(res, "export applications");
  const flat = rows.map((r) => {
    const sc = Array.isArray(r.job?.job_scores) ? r.job?.job_scores[0] : r.job?.job_scores;
    return {
      company: r.job?.company, title: r.job?.title, country: r.job?.country, portal: portalLabel(r.job?.portal ?? r.job?.source?.split(":")[0]), found_via: r.job?.source?.split(":")[0],
      apply_type: r.job?.apply_type, fit_score: sc?.score, status: APP_STATUS_LABEL[r.status] ?? r.status, method: r.method, outcome: r.lifecycle,
      discovered_at: r.job?.found_at, approved_at: r.approved_at, submitted_at: r.submitted_at,
      resume_version: r.resume?.version, resume_model: r.resume?.model, resume_file: r.resume?.storage_path, url: r.job?.url, error: r.error, notes: r.notes,
    };
  });
  const cols = ["company", "title", "country", "portal", "found_via", "apply_type", "fit_score", "status", "method", "outcome", "discovered_at", "approved_at", "submitted_at", "resume_version", "resume_model", "resume_file", "url", "error", "notes"];
  return new Response(toCsv(flat, cols), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="applications.csv"' } });
}
