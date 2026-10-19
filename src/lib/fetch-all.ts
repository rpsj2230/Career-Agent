/**
 * Supabase returns at most 1000 rows per request, whatever `.limit()` asks for, so counting from one request silently
 * stops at 1000. This reads page after page until a short page comes back. Give each query a stable `.order(...)`
 * (for example on id) so that no row is read twice or skipped between pages.
 */
type Res = { data: unknown; error: { message: string } | null };
export const PAGE_SIZE = 1000;

export async function fetchAll<T = Record<string, unknown>>(page: (from: number, to: number) => PromiseLike<Res>, max = 50_000): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE_SIZE) {
    const r = await page(from, from + PAGE_SIZE - 1);
    if (r.error) return { data: out, error: r.error };
    const rows = (r.data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return { data: out, error: null };
}
