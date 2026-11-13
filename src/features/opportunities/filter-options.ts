import type { Locale } from "@/i18n/routing";
import { regionName } from "@/lib/format";
import { getCityName } from "@/lib/opportunities/cities";
import { getFilterOptions } from "@/services/opportunities";

export interface SelectOption {
  value: string;
  label: string;
}
export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

/**
 * Country and city options for the filter selects, localized and sorted with the locale's
 * collation. Azerbaijan always comes first (first-class market), then other countries A→Z.
 * Only places that actually have public records are offered.
 */
export async function buildFilterOptions(locale: Locale): Promise<{ countries: SelectOption[]; cityGroups: SelectGroup[] }> {
  const { countries, cities } = await getFilterOptions();
  const collator = new Intl.Collator(locale);
  const azFirst = (a: string, b: string, la: string, lb: string) => (a === "AZ" ? -1 : b === "AZ" ? 1 : collator.compare(la, lb));

  const countryOptions = countries
    .map((code) => ({ value: code, label: regionName(code, locale) }))
    .sort((a, b) => azFirst(a.value, b.value, a.label, b.label));

  const cityGroups = [...new Set(cities.map((c) => c.country))]
    .sort((a, b) => azFirst(a, b, regionName(a, locale), regionName(b, locale)))
    .map((country) => ({
      label: regionName(country, locale),
      options: cities
        .filter((c) => c.country === country)
        .map((c) => ({ value: c.id, label: getCityName(c.id, null, locale) ?? c.id }))
        .sort((a, b) => collator.compare(a.label, b.label)),
    }));

  return { countries: countryOptions, cityGroups };
}
