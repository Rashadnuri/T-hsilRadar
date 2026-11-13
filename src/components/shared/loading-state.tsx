import { Skeleton } from "@/components/ui/skeleton";
import { LoadingStatus } from "@/components/layout/loading-status";

function CardSkeleton() {
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-card">
      <div className="flex gap-2">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-14 rounded-full" />
      </div>
      <Skeleton className="h-6 w-4/5" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-5 w-2/3" />
    </div>
  );
}

/** Skeleton placeholder for card grids; announces "loading" to screen readers in the active language. */
export function LoadingState({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true">
      <LoadingStatus />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
