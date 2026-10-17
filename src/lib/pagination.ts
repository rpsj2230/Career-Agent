export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** `?page=3&size=50` from a page's search params. Anything unusable falls back to page 1, 25 per page. */
export function parsePaging(sp: SP, fallbackSize: number = DEFAULT_PAGE_SIZE): { page: number; size: number } {
  const size = Number(first(sp.size));
  const page = Number(first(sp.page));
  return {
    page: Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : fallbackSize,
  };
}

/** Clamp a requested page to what exists, and give the row range (0-based, inclusive) to fetch. */
export function pageRange(total: number, page: number, size: number) {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, page), pages);
  const from = (p - 1) * size;
  return { page: p, pages, from, to: from + size - 1, shownFrom: total === 0 ? 0 : from + 1, shownTo: Math.min(total, p * size) };
}

/** Page numbers to show: first, last, and a window around the current page, with gaps marked null. */
export function pageNumbers(page: number, pages: number, around = 2): (number | null)[] {
  const keep = new Set([1, pages]);
  for (let i = page - around; i <= page + around; i++) if (i >= 1 && i <= pages) keep.add(i);
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => { if (i > 0 && n - sorted[i - 1] > 1) out.push(null); out.push(n); });
  return out;
}

/** The same page with another page number (and size), keeping every filter in the URL. */
export function pageHref(basePath: string, sp: SP, page: number, size?: number): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "page" || (k === "size" && size !== undefined)) continue;
    const val = first(v);
    if (val) q.set(k, val);
  }
  if (size !== undefined && size !== DEFAULT_PAGE_SIZE) q.set("size", String(size));
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}
