import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { Facets } from "@/lib/opportunities/search";
import type { OpportunityFilters } from "@/validation/opportunity-filters";
import { buildQuery } from "./query";

const TABS = ["all", "azerbaijan", "international"] as const;

/**
 * The dedicated Azerbaijan / International switch. Each tab is a plain link that keeps every
 * other active filter and shows how many results it would give.
 */
export async function ScopeTabs({ filters, facets }: { filters: OpportunityFilters; facets: Facets }) {
  const [t, format] = await Promise.all([getTranslations("catalogue.scopeTabs"), getFormatter()]);
  const current = filters.scope ?? "all";

  return (
    <nav aria-label={t("label")}>
      <ul className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border bg-card p-1 shadow-soft">
        {TABS.map((tab) => {
          const active = tab === current;
          return (
            <li key={tab}>
              <Link
                href={{ pathname: "/opportunities", query: buildQuery(filters, { scope: tab === "all" ? undefined : tab, page: undefined }) }}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-primary",
                )}
              >
                {t(tab)}
                <span className={cn("rounded-full px-2 py-0.5 text-xs", active ? "bg-white/20" : "bg-muted")}>{format.number(facets.scope[tab === "all" ? "all" : tab])}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
