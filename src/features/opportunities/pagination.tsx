import { ChevronLeft, ChevronRight } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { OpportunityFilters } from "@/validation/opportunity-filters";
import { buildQuery } from "./query";

interface PaginationProps {
  page: number;
  totalPages: number;
  filters: OpportunityFilters;
}

/** 1 … 4 5 6 … 12 style window, always showing first and last page. */
function pageWindow(page: number, total: number): (number | "gap")[] {
  const pages = new Set([1, total, page - 1, page, page + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1]! > 1 ? ["gap" as const, p] : [p]));
}

const itemClass =
  "inline-flex size-11 items-center justify-center rounded-lg border text-sm font-semibold transition-colors sm:size-10";

export async function Pagination({ page, totalPages, filters }: PaginationProps) {
  if (totalPages <= 1) return null;
  const [t, format] = await Promise.all([getTranslations("pagination"), getFormatter()]);
  const href = (p: number) => ({ pathname: "/opportunities" as const, query: buildQuery(filters, { page: p }) });

  return (
    <nav aria-label={t("label")} className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" aria-label={t("previous")} className={cn(itemClass, "bg-background hover:bg-secondary")}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <span aria-hidden="true" className={cn(itemClass, "pointer-events-none opacity-40")}>
          <ChevronLeft className="size-4" />
        </span>
      )}
      <ul className="flex items-center gap-2">
        {pageWindow(page, totalPages).map((item, index) =>
          item === "gap" ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-muted-foreground">
              …
            </li>
          ) : (
            <li key={item}>
              <Link
                href={href(item)}
                aria-label={t("page", { page: item })}
                aria-current={item === page ? "page" : undefined}
                className={cn(
                  itemClass,
                  item === page ? "border-primary bg-primary text-primary-foreground" : "bg-background text-primary hover:bg-secondary",
                )}
              >
                {format.number(item)}
              </Link>
            </li>
          ),
        )}
      </ul>
      {page < totalPages ? (
        <Link href={href(page + 1)} rel="next" aria-label={t("next")} className={cn(itemClass, "bg-background hover:bg-secondary")}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <span aria-hidden="true" className={cn(itemClass, "pointer-events-none opacity-40")}>
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}
