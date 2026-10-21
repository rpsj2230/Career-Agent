import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder for a card that loads on its own, so the rest of the page does not wait for it. */
export function CardSkeleton({ height = "h-24" }: { height?: string }) {
  return <Skeleton className={`${height} w-full`} aria-hidden="true" />;
}
