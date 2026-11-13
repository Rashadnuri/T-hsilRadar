import { defineRouting } from "next-intl/routing";

export const locales = ["az", "ru", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "az";

/**
 * Every URL carries its locale (/az, /ru, /en).
 * Detection order at "/" (handled by the proxy): NEXT_LOCALE cookie →
 * Accept-Language → defaultLocale. Deep links are never redirected to another language.
 */
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
  localeDetection: true,
  // hreflang alternates are emitted in page metadata (lib/metadata.ts); the proxy's Link
  // header would duplicate them and point x-default at "/".
  alternateLinks: false,
});
