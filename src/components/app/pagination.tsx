import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DEFAULT_PAGE_SIZE, pageHref, pageNumbers, PAGE_SIZES } from "@/lib/pagination";

type SP = Record<string, string | string[] | undefined>;
type Common = { basePath: string; sp: SP; size: number; defaultSize?: number };

/** At the top of a list: how many rows to show per page (10, 25, 50 or 100). Plain links, so it works without scripts and keeps every filter. */
export function PageSizeBar({ basePath, sp, size, defaultSize = DEFAULT_PAGE_SIZE, total, shownFrom, shownTo }: Common & { total: number; shownFrom: number; shownTo: number }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-xs text-muted-foreground">{total === 0 ? "No results" : `Showing ${shownFrom}-${shownTo} of ${total}`}</span>
      <div className="flex items-center gap-1 text-xs text-muted-foreground" role="group" aria-label="Rows per page">
        Show
        {PAGE_SIZES.map((s) => (
          <Button key={s} asChild size="sm" variant={s === size ? "secondary" : "ghost"}>
            <Link href={pageHref(basePath, sp, 1, s, defaultSize)} aria-current={s === size ? "true" : undefined}>{s}</Link>
          </Button>
        ))}
        per page
      </div>
    </div>
  );
}

/** At the bottom of a list: Previous, Page 1, Page 2 ... Next, with the current page marked. Hidden when everything fits on one page. */
export function Pagination({ basePath, sp, page, pages, size, defaultSize = DEFAULT_PAGE_SIZE }: Common & { page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-center gap-1 text-sm">
      {page > 1 ? <Button asChild variant="outline" size="sm"><Link href={pageHref(basePath, sp, page - 1, size, defaultSize)}>Previous</Link></Button> : <Button variant="outline" size="sm" disabled>Previous</Button>}
      {pageNumbers(page, pages).map((n, i) => n === null
        ? <span key={`gap${i}`} className="px-1 text-muted-foreground">…</span>
        : <Button key={n} asChild size="sm" variant={n === page ? "default" : "outline"} className="min-w-9"><Link href={pageHref(basePath, sp, n, size, defaultSize)} aria-label={`Page ${n}`} aria-current={n === page ? "page" : undefined}>{n}</Link></Button>)}
      {page < pages ? <Button asChild variant="outline" size="sm"><Link href={pageHref(basePath, sp, page + 1, size, defaultSize)}>Next</Link></Button> : <Button variant="outline" size="sm" disabled>Next</Button>}
      <span className="ml-2 text-xs text-muted-foreground">Page {page} of {pages}</span>
    </nav>
  );
}
