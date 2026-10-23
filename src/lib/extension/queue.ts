/**
 * The applications the extension can open for you one after another: the ones waiting for you to finish by hand. Pure.
 */
export type QueueRow = {
  id: string;
  status: string;
  error: string | null;
  job: { title: string; company: string; url: string } | null;
  finalUrl: string | null;
  resume: { name: string } | null;
  cover: { name: string } | null;
};

export type QueueItem = { id: string; company: string; title: string; formUrl: string; note: string; resume: { name: string } | null; cover: { name: string } | null };

export const QUEUE_STATUSES = ["assisted_pending", "needs_input", "failed"] as const;
export const QUEUE_LIMIT = 40;

const http = (u: string | null | undefined): u is string => !!u && /^https?:\/\//i.test(u);

export function buildQueue(rows: QueueRow[]): QueueItem[] {
  const out: QueueItem[] = [];
  for (const r of rows) {
    if (!r.job) continue;
    const formUrl = http(r.finalUrl) ? r.finalUrl : http(r.job.url) ? r.job.url : null;
    if (!formUrl) continue;
    out.push({
      id: r.id, company: r.job.company, title: r.job.title, formUrl,
      note: r.status === "needs_input" ? "Waiting for an answer" : r.status === "failed" ? "The assistant could not finish it" : "Waiting for you or the assistant",
      resume: r.resume, cover: r.cover,
    });
    if (out.length >= QUEUE_LIMIT) break;
  }
  return out;
}

/** The queue item that belongs to the page you are on: the same site as its form (or job) link, the one with a resume first. */
export function itemForPage(queue: QueueItem[], pageUrl: string): QueueItem | null {
  let host: string;
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ""); } catch { return null; }
  const same = queue.filter((q) => { try { return new URL(q.formUrl).hostname.replace(/^www\./, "") === host; } catch { return false; } });
  return same.find((q) => q.resume) ?? same[0] ?? null;
}
