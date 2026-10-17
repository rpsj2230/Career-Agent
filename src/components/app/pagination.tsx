import Link from "next/link";
import { Button } from "@/components/ui/button";
import { pageHref, pageNumbers, PAGE_SIZES } from "@/lib/pagination";

type SP = Record<string, string | string[] | undefined>;

/** Previous / numbered pages / Next, a per-page choice and "Showing a-b of N". Plain links, so it works without scripts and keeps every filter. */
export function Pagination({ basePath, sp, page, pages, size, total, shownFrom, shownTo }: { basePath: string; sp: SP; page: number; pages: number; size: number; total: number; shownFrom: number; shownTo: number }) {
  if (total === 0) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-xs text-muted-foreground">Showing {shownFrom}-{shownTo} of {total}</span>
      <div className="flex flex-wrap items-center gap-1">
        {pages > 1 && (
          <>
            {page > 1 ? <Button asChild variant="outline" size="sm"><Link href={pageHref(basePath, sp, page - 1, size)}>Previous</Link></Button> : <Button variant="outline" size="sm" disabled>Previous</Button>}
            {pageNumbers(page, pages).map((n, i) => n === null
              ? <span key={`gap${i}`} className="px-1 text-muted-foreground">…</span>
              : <Button key={n} asChild size="sm" variant={n === page ? "default" : "outline"}><Link href={pageHref(basePath, sp, n, size)} aria-current={n === page ? "page" : undefined}>{n}</Link></Button>)}
            {page < pages ? <Button asChild variant="outline" size="sm"><Link href={pageHref(basePath, sp, page + 1, size)}>Next</Link></Button> : <Button variant="outline" size="sm" disabled>Next</Button>}
          </>
        )}
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">Per page:
        {PAGE_SIZES.map((s) => <Button key={s} asChild size="sm" variant={s === size ? "secondary" : "ghost"}><Link href={pageHref(basePath, sp, 1, s)}>{s}</Link></Button>)}
      </div>
    </nav>
  );
}
