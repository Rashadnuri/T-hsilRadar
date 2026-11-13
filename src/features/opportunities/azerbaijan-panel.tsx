import { MapPin } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getCityName } from "@/lib/opportunities/cities";
import type { Facets } from "@/lib/opportunities/search";
import { cn } from "@/lib/utils";
import type { OpportunityType } from "@/types/opportunity";
import type { OpportunityFilters } from "@/validation/opportunity-filters";
import { buildQuery } from "./query";
import { opportunityTypeIcons } from "./type-icons";

const SHORTCUTS = ["scholarship", "internship", "grant"] as const satisfies readonly OpportunityType[];

const chip = "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors";

/**
 * Shown when the Azerbaijan tab is active: Azerbaijani cities (with counts) and one-click
 * shortcuts for the local categories people look for first. Every chip is a link that keeps the
 * other active filters; clicking an active chip clears it.
 */
export async function AzerbaijanPanel({ filters, facets }: { filters: OpportunityFilters; facets: Facets }) {
  const [t, format, locale] = await Promise.all([getTranslations("catalogue.azerbaijan"), getFormatter(), getLocale() as Promise<Locale>]);
  const tType = await getTranslations("opportunityTypes");
  const base = { scope: "azerbaijan", page: undefined } as const;

  return (
    <section aria-labelledby="az-panel-heading" className="rounded-2xl border bg-gradient-to-br from-secondary to-card p-5 shadow-card">
      <h2 id="az-panel-heading" className="flex items-center gap-2 text-lg font-semibold">
        <MapPin className="size-5 text-accent" aria-hidden="true" />
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-primary">{t("shortcuts")}</h3>
          <ul className="flex flex-wrap gap-2">
            {SHORTCUTS.map((type) => {
              const Icon = opportunityTypeIcons[type];
              const active = filters.type === type;
              return (
                <li key={type}>
                  <Link
                    href={{ pathname: "/opportunities", query: buildQuery(filters, { ...base, type: active ? undefined : type }) }}
                    aria-current={active ? "true" : undefined}
                    className={cn(chip, active ? "border-primary bg-primary text-primary-foreground" : "bg-background text-primary hover:border-accent")}
                    title={tType(type)}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {t(type)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-primary">{t("cities")}</h3>
          <ul className="flex flex-wrap gap-2">
            {facets.azerbaijaniCities.map(({ id, count }) => {
              const active = filters.city === id;
              return (
                <li key={id}>
                  <Link
                    href={{ pathname: "/opportunities", query: buildQuery(filters, { ...base, city: active ? undefined : id }) }}
                    aria-current={active ? "true" : undefined}
                    className={cn(chip, active ? "border-primary bg-primary text-primary-foreground" : "bg-background text-primary hover:border-accent")}
                  >
                    {getCityName(id, null, locale)}
                    <span className={cn("rounded-full px-1.5 text-xs", active ? "bg-white/20" : "bg-muted")}>{format.number(count)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
