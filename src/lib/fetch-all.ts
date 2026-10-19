/**
 * Supabase returns at most 1000 rows per request, whatever `.limit()` asks for, so counting from one request silently
 * stops at 1000. This reads page after page until a short page comes back. Give each query a stable `.order(...)`
 * (for example on id) so that no row is read twice or skipped between pages.
 */
type Res = { data: unknown; error: { message: string } | null };
export const PAGE_SIZE = 1000;

/** Pages are requested a few at a time (in order, so no row is read twice) instead of one after the other, which cuts the waiting by about a factor of FETCH_PARALLEL. */
const FETCH_PARALLEL = 4;

export async function fetchAll<T = Record<string, unknown>>(page: (from: number, to: number) => PromiseLike<Res>, max = 50_000): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; from < max;) {
    const starts = Array.from({ length: FETCH_PARALLEL }, (_, i) => from + i * PAGE_SIZE).filter((f) => f < max);
    const results = await Promise.all(starts.map((f) => page(f, f + PAGE_SIZE - 1)));
    for (const r of results) {
      if (r.error) return { data: out, error: r.error };
      const rows = (r.data as T[] | null) ?? [];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) return { data: out, error: null };
    }
    from = starts[starts.length - 1] + PAGE_SIZE;
  }
  return { data: out, error: null };
}
