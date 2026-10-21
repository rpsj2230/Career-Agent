import { Skeleton } from "@/components/ui/skeleton";

/** Shown the moment a link is clicked, while the page's data is read, so a click always visibly does something. */
export default function Loading() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-full max-w-3xl" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
