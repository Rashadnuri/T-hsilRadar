import type { MetadataRoute } from "next";
import { routing, type Locale } from "@/i18n/routing";
import { resolveContent } from "@/lib/opportunities/translations";
import { absoluteUrl, languageAlternates } from "@/lib/site";
import type { OpportunityRecord } from "@/types/opportunity";

/** Static, language-neutral routes that exist in every locale. */
export const STATIC_PATHS = ["", "/opportunities", "/about", "/contact"] as const;

const entries = (path: string, locales: readonly Locale[], lastModified?: Date): MetadataRoute.Sitemap =>
  locales.map((locale) => ({
    url: absoluteUrl(locale, path),
    ...(lastModified ? { lastModified } : {}),
    alternates: { languages: languageAlternates(path, locales) },
  }));

/**
 * The sitemap: static pages in every locale, plus every public, NON-demo, active opportunity in the
 * languages in which it is fully available (a page that falls back to another language is `noindex`
 * and so is never listed). Demo records and expired records (the search excludes them) are not listed.
 * Pure function: the route handler supplies the records.
 */
export function buildSitemap(records: readonly OpportunityRecord[]): MetadataRoute.Sitemap {
  const pages = STATIC_PATHS.flatMap((path) => entries(path, routing.locales));
  const opportunities = records
    .filter((o) => !o.isDemo)
    .flatMap((o) => {
      const locales = routing.locales.filter((l) => resolveContent(o, l).isFullyInRequestedLanguage);
      return locales.length ? entries(`/opportunities/${o.slug}`, locales, new Date(o.updatedAt)) : [];
    });
  return [...pages, ...opportunities];
}
