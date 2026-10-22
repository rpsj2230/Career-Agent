/**
 * When no model can write a tailored resume, the application is not given the plain master resume straight away: the writing is tried again
 * (a free model that is rate limited or busy usually answers a minute later), and if it still fails the job is left for the next hourly round.
 * Only after `DEFER_ROUNDS` failed rounds is the master resume attached, so an application is never left undone for good.
 */
export const DEFER_ROUNDS = 2;
/** waits before the second and third try inside one round (free models limit requests per minute) */
export const RETRY_WAITS_MS = [15_000, 45_000];
/** a person pressing Prepare is waiting for the answer: a short wait, one more try */
export const INTERACTIVE_WAITS_MS = [3_000];

/** Errors that a later try can fix: a model that is busy, rate limited, timing out or out of allowance for the moment. */
export const isTransient = (message: string): boolean => /rate.?limit|429|quota|timeout|timed? ?out|overload|unavailable|busy|temporar|no model available|all models failed|too many|try again|5\d\d\b/i.test(message);

/** Run `fn`, trying again after each wait while it fails with a transient error. Throws the last error. Pure apart from `sleep`. */
export async function withRetries<T>(fn: () => Promise<T>, o: { waits: number[]; sleep?: (ms: number) => Promise<void>; onRetry?: (attempt: number, error: string) => void }): Promise<T> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const wait = o.waits[attempt];
      if (wait === undefined || !isTransient(message)) throw e;
      o.onRetry?.(attempt + 1, message);
      await sleep(wait);
    }
  }
}

/** After every try in this round failed: leave the job for the next round, or give in and use the master resume? */
export const shouldDefer = (failedRoundsBefore: number): boolean => failedRoundsBefore < DEFER_ROUNDS;

export const deferredMessage = (reason: string, failedRoundsBefore: number): string =>
  `The resume could not be written yet (${reason.slice(0, 200)}). It is tried again next round (attempt ${failedRoundsBefore + 1} of ${DEFER_ROUNDS + 1}); only after that is your master resume attached instead.`;
