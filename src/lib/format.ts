import { DEFAULT_TIME_ZONE } from "@/i18n/formats";
import type { Locale } from "@/i18n/routing";

/**
 * Plain-Intl helpers for non-React code (services, sitemap, emails later).
 * In components prefer next-intl's useFormatter()/getFormatter().
 */
export function formatDate(value: Date | string, locale: Locale, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone }).format(new Date(value));
}

/**
 * Deadline/start instant, computed in the organization's own time zone (so the clock time is the one the
 * organization means) but shown WITHOUT a zone label such as "GMT+4": the site's readers asked for plain dates.
 */
export function formatDateTimeInZone(value: Date | string, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone,
  }).format(new Date(value));
}

/** Always shows the currency code from the source; amounts are never converted silently. */
export function formatMoney(amount: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
}

/** Locale-aware collation (correct ordering of ç, ş, ğ, ı, ö, ü, ə in Azerbaijani). */
export function compareText(locale: Locale) {
  const collator = new Intl.Collator(locale);
  return (a: string, b: string) => collator.compare(a, b);
}

/** Localised country/region name (CLDR via Intl); no hand-maintained country tables. */
export function regionName(code: string, locale: Locale): string {
  return new Intl.DisplayNames(locale, { type: "region" }).of(code) ?? code;
}
