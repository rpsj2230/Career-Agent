/**
 * A response that is always sent before the host's hard limit (60 s on Vercel Hobby), whatever the work is doing. If the work
 * has not finished by `ms`, `late` is returned instead; the work is not cancelled but everything it already stored stays, and
 * every step stores its result as it goes, so the next press simply continues.
 */
export async function within<T>(work: Promise<T>, ms: number, late: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(late()), ms); });
  try { return await Promise.race([work, limit]); } finally { clearTimeout(timer); }
}
