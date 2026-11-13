import { getCountryOptions, getLanguageOptions } from "@/lib/countries";
import { CITIES, getCityName } from "@/lib/opportunities/cities";
import type { Locale } from "@/i18n/routing";
import type { AdminOrganization } from "@/repositories/admin/types";

/** Localized option lists for the admin forms (computed on the server, passed to the client form as plain data). */
export function buildFormOptions(locale: Locale, organizations: AdminOrganization[]) {
  const languages = getLanguageOptions(locale);
  const first = ["az", "ru", "en"].flatMap((code) => languages.filter((l) => l.value === code));
  return {
    organizations: organizations.map((o) => ({ value: o.id, label: o.name })),
    countries: getCountryOptions(locale),
    cities: CITIES.map((c) => ({ value: c.id, label: `${getCityName(c.id, null, locale) ?? c.id} (${c.country})` })),
    originalLanguageOptions: [...first, ...languages.filter((l) => !["az", "ru", "en"].includes(l.value))],
  };
}
