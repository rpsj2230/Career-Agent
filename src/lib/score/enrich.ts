import "server-only";
import { db } from "@/lib/db";
import { fetchJobText, isReadablePage } from "@/lib/jobs/posting";

export const THIN_DESCRIPTION = 500;

/**
 * Sources such as Adzuna and job-alert emails give only a snippet. For a job that already passed the free pre-checks, read the job's own
 * page (employer or applicant-tracking site; never a job portal) so it is scored, and later tailored for, on the real description.
 * Returns the full text when it was found and stored, otherwise null. Never throws.
 */
export async function enrichIfThin(job: { id: string; url: string; description: string }): Promise<string | null> {
  try {
    if (job.description.length >= THIN_DESCRIPTION || !isReadablePage(job.url)) return null;
    const text = await fetchJobText(job.url);
    if (!text || text.length <= job.description.length + 100) return null;
    const { error } = await db().from("jobs").update({ description: text }).eq("id", job.id);
    return error ? null : text;
  } catch { return null; }
}
