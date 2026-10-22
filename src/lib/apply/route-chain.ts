import { ROUTE_LABEL, type RouteId } from "@/lib/jobs/more-routes";

/** One way in that was tried for a job, and what came of it. */
export type RouteAttempt = {
  route: RouteId;
  outcome: "worked" | "no-link" | "none-found" | "unusable" | "unavailable" | "error";
  detail?: string;
};

const WORDS: Record<RouteAttempt["outcome"], string> = {
  worked: "worked",
  "no-link": "had no usable link",
  "none-found": "found nothing for this job",
  unusable: "found links but none opened an application form",
  unavailable: "could not be tried",
  error: "failed",
};

/** One plain line per route, for the hand-back message and the log: "Routes tried (3): the job board's own Apply link: had no usable link; ...". */
export function summariseAttempts(attempts: RouteAttempt[]): string {
  if (attempts.length === 0) return "";
  const parts = attempts.map((a) => `${ROUTE_LABEL[a.route]}: ${WORDS[a.outcome]}${a.detail ? ` (${a.detail})` : ""}`);
  return `Routes tried (${attempts.length}): ${parts.join("; ")}.`;
}

/** True when at least one route led to a form. */
export const reachedForm = (attempts: RouteAttempt[]) => attempts.some((a) => a.outcome === "worked");
