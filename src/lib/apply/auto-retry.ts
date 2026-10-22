/**
 * An application whose last attempt failed for a reason that a second try can fix (a worker that stopped, a timeout, a page that did not
 * load, or a hand-back left over from before LinkedIn was routed to the assistant on your computer) goes back in the queue by itself,
 * at most twice. Anything that retrying cannot fix (already applied, the role is closed, a CAPTCHA) stays failed, with its reason, for you.
 */
export const MAX_AUTO_RETRIES = 2;

const NEVER_RETRY = /create (an )?account|types? a password|never downloads|did not touch this page|payment or bank details|identity or tax number|already applied|applied to .* recently|no longer|closed|expired|duplicate|not found|captcha|security check|verification|rejected|not eligible/i;
const RETRYABLE = /signed-in linkedin session|apply through the local assistant|timed? ?out|timeout|navigation|net::|econn|enotfound|could not reach|temporar|try again|rate.?limit|worker stopped|did not finish|browser|crash|target closed|session/i;

/** Would a second try plausibly work? A failure with no recorded reason is tried again. */
export function isRetryable(error: string | null | undefined): boolean {
  const e = (error ?? "").trim();
  if (!e) return true;
  if (NEVER_RETRY.test(e)) return false;
  return RETRYABLE.test(e);
}

export type FailedRow = { id: string; job_id: string; error: string | null };

/** Which of the failed applications go back in the queue now: retryable, and not yet tried again `max` times. Oldest first, at most `limit`. */
export function pickRetries(rows: FailedRow[], attempts: Map<string, number>, o: { max?: number; limit?: number } = {}): FailedRow[] {
  const max = o.max ?? MAX_AUTO_RETRIES;
  return rows.filter((r) => isRetryable(r.error) && (attempts.get(r.id) ?? 0) < max).slice(0, o.limit ?? 100);
}
