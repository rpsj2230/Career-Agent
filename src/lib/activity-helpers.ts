import "server-only";
import { logActivity } from "./activity";
import type { LogEntry } from "./activity-types";

/** Job fields every log line about a job should carry, so logs can be filtered by portal, country and company. */
export type JobRef = { id: string; company?: string | null; country?: string | null; portal?: string | null; source?: string | null };

export const jobLogFields = (j: JobRef) => ({
  job_id: j.id, company: j.company ?? null, country: j.country ?? null, portal: j.portal ?? j.source?.split(":")[0] ?? null,
});

/** Records a configuration change. Pass only non-secret summaries; credentials and keys must never go in `detail`. */
export function logConfig(what: string, detail: Record<string, unknown> = {}, kind: LogEntry["kind"] = "config.changed") {
  return logActivity({ kind, message: what, detail });
}
