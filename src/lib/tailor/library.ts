import { titleFamily, tokenize } from "./similarity";

/** One resume the agent made, as listed on the Resumes page. */
export type LibraryRow = {
  documentId: string; jobId: string; title: string; company: string; country: string | null; createdAt: string; version: number; storagePath: string;
  verified: boolean; style: string | null; mode: "fresh" | "reused" | "adapted" | "master"; sourceTitle: string | null; lifecycle: string; usedAgain: number;
};

type Doc = { id: string; job_id: string; version: number; storage_path: string; created_at: string; verification: { ok?: boolean; style?: string; fallback?: string; reuse?: { mode?: string; from?: { jobId?: string; title?: string } } } | null; job: { title?: string; company?: string; country?: string | null } | null };

/** Newest resume per job, with how it was made and how many later resumes were built on it. Newest first. */
export function buildLibrary(docs: Doc[], lifecycleByJob: Map<string, string>): LibraryRow[] {
  const newest = new Map<string, Doc>();
  for (const d of [...docs].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))) if (!newest.has(d.job_id)) newest.set(d.job_id, d);
  const usedAgain = new Map<string, number>();
  for (const d of newest.values()) {
    const from = d.verification?.reuse?.from?.jobId;
    if (from && d.job_id !== from && (d.verification?.reuse?.mode === "reused" || d.verification?.reuse?.mode === "adapted")) usedAgain.set(from, (usedAgain.get(from) ?? 0) + 1);
  }
  return [...newest.values()].map((d) => {
    const r = d.verification?.reuse;
    const mode: LibraryRow["mode"] = d.verification?.fallback ? "master" : r?.mode === "reused" ? "reused" : r?.mode === "adapted" ? "adapted" : "fresh";
    return {
      documentId: d.id, jobId: d.job_id, title: d.job?.title ?? "Job", company: d.job?.company ?? "", country: d.job?.country ?? null, createdAt: d.created_at ?? "", version: d.version, storagePath: d.storage_path,
      verified: d.verification?.ok === true, style: d.verification?.style ?? null,
      mode,
      sourceTitle: r?.from?.title ?? null, lifecycle: lifecycleByJob.get(d.job_id) ?? "none", usedAgain: usedAgain.get(d.job_id) ?? 0,
    };
  }).sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

const MODE_TAG: Record<LibraryRow["mode"], string> = { fresh: "written for this job", reused: "reused", adapted: "adapted", master: "master resume" };

/** Short labels for finding a resume again: role words, country, style, how it was made and how it went. */
export function tagsFor(r: LibraryRow): string[] {
  const tags = new Set<string>();
  for (const w of titleFamily(r.title).slice(0, 4)) tags.add(w);
  if (r.country) tags.add(r.country.toUpperCase());
  if (r.style) tags.add(`${r.style} style`);
  tags.add(MODE_TAG[r.mode]);
  if (r.lifecycle !== "none") tags.add(r.lifecycle);
  if (r.usedAgain > 0) tags.add(`reused ${r.usedAgain}×`);
  if (!r.verified) tags.add("needs review");
  return [...tags];
}

/** Does a row match what was typed (any word in the title, company, country or a tag)? */
export function matchesQuery(r: LibraryRow, q: string): boolean {
  const words = tokenize(q);
  if (words.length === 0) return true;
  const hay = tokenize([r.title, r.company, r.country ?? "", ...tagsFor(r)].join(" "));
  return words.every((w) => hay.some((h) => h.includes(w)));
}
