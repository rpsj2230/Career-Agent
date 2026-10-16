import { db, must } from "@/lib/db";
import { toCsv } from "@/lib/csv";

type Row = {
  status: string; method: string | null; lifecycle: string; submitted_at: string | null; approved_at: string | null; created_at: string; error: string | null; notes: string | null;
  job: { title: string; company: string; country: string | null; url: string; source: string; apply_type: string; job_scores: { score: number } | { score: number }[] | null } | null;
  resume: { version: number; model: string | null; storage_path: string | null } | null;
};

export async function GET() {
  const rows = must<Row[]>(
    await db().from("applications")
      .select("status,method,lifecycle,submitted_at,approved_at,created_at,error,notes, job:jobs(title,company,country,url,source,apply_type,job_scores(score)), resume:documents!applications_resume_doc_id_fkey(version,model,storage_path)")
      .order("created_at", { ascending: false }),
    "export applications",
  );
  const flat = rows.map((r) => {
    const sc = Array.isArray(r.job?.job_scores) ? r.job?.job_scores[0] : r.job?.job_scores;
    return {
      company: r.job?.company, title: r.job?.title, country: r.job?.country, source: r.job?.source, apply_type: r.job?.apply_type, fit_score: sc?.score,
      status: r.status, method: r.method, lifecycle: r.lifecycle, approved_at: r.approved_at, submitted_at: r.submitted_at,
      resume_version: r.resume?.version, resume_model: r.resume?.model, resume_file: r.resume?.storage_path, url: r.job?.url, error: r.error, notes: r.notes,
    };
  });
  const cols = ["company", "title", "country", "source", "apply_type", "fit_score", "status", "method", "lifecycle", "approved_at", "submitted_at", "resume_version", "resume_model", "resume_file", "url", "error", "notes"];
  return new Response(toCsv(flat, cols), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="applications.csv"' } });
}
