import { Container } from "@/components/layout/container";
import { LoadingState } from "@/components/shared/loading-state";
import { Skeleton } from "@/components/ui/skeleton";

// Scoped to this route on purpose. A locale-wide loading.tsx would make every page
// (including the catch-all 404) stream, so unknown URLs would answer HTTP 200 instead of 404.
export default function Loading() {
  return (
    <Container className="py-10 sm:py-14">
      <Skeleton className="h-10 w-2/3 max-w-md" />
      <Skeleton className="mt-4 h-5 w-full max-w-xl" />
      <Skeleton className="mb-8 mt-8 h-14 w-full rounded-2xl" />
      <LoadingState />
    </Container>
  );
}
