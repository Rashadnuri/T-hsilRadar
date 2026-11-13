import { X } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { regionName } from "@/lib/format";
import { getCityName } from "@/lib/opportunities/cities";
import { FILTER_KEYS, type FilterKey, type OpportunityFilters } from "@/validation/opportunity-filters";
import { buildQuery } from "./query";

/** Removable chips for the active filters; each chip is a plain link that drops one parameter (others are kept). */
export async function ActiveFilters({ filters }: { filters: OpportunityFilters }) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale() as Promise<Locale>]);

  const valueLabel = (key: FilterKey): string | undefined => {
    switch (key) {
      case "q":
        return filters.q ? `“${filters.q}”` : undefined;
      case "scope":
        return filters.scope && t(`scope.${filters.scope}`);
      case "country":
        return filters.country && regionName(filters.country, locale);
      case "city":
        return filters.city && (getCityName(filters.city, null, locale) ?? filters.city);
      case "type":
        return filters.type && t(`opportunityTypes.${filters.type}`);
      case "level":
        return filters.level && t(`level.${filters.level}`);
      case "field":
        return filters.field && t(`fields.${filters.field}`);
      case "funding":
        return filters.funding && t(`funding.${filters.funding}`);
      case "location":
        return filters.location && t(`locationType.${filters.location}`);
      case "deadline":
        return filters.deadline && t(`deadlineFilter.${filters.deadline}`);
      case "verification":
        return filters.verification && t(`verification.${filters.verification}`);
    }
  };

  const active = FILTER_KEYS.flatMap((key) => {
    const label = valueLabel(key);
    return label ? [{ key, label }] : [];
  });
  if (active.length === 0) return null;

  return (
    <ul aria-label={t("catalogue.activeFilters")} className="flex flex-wrap gap-2">
      {active.map(({ key, label }) => (
        <li key={key}>
          <Link
            href={{ pathname: "/opportunities", query: buildQuery(filters, { [key]: undefined, page: undefined }) }}
            aria-label={t("catalogue.removeFilter", { label })}
            className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border bg-secondary px-3 text-sm font-medium text-primary transition-colors hover:border-accent"
          >
            <span className="min-w-0">{label}</span>
            <X className="size-3.5 shrink-0" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
