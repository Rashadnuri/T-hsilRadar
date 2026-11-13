import { Container } from "@/components/layout/container";
import { LoadingStatus } from "@/components/layout/loading-status";
import { Skeleton } from "@/components/ui/skeleton";

// Scoped to this route (a locale-wide loading.tsx would make the 404 page answer 200).
export default function Loading() {
  return (
    <Container className="py-10 sm:py-14">
      <div className="mx-auto max-w-4xl">
        <LoadingStatus />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-4 h-5 w-full max-w-xl" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="mt-10 h-8 w-56" />
        <div className="mt-5 space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-3 rounded-2xl border bg-card p-6 shadow-card">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-4/5" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      </div>
    </Container>
  );
}
