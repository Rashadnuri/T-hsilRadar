import type { Metadata } from "next";
import { localeMeta } from "@/i18n/locales";
import type { Locale } from "@/i18n/routing";
import { absoluteUrl, languageAlternates, SITE_NAME } from "./site";

interface PageMetadataInput {
  locale: Locale;
  /** Path without the locale prefix, e.g. "/about". */
  path?: string;
  title: string;
  description: string;
  /** Use for pages that must not be indexed (e.g. fallback-language content). */
  noindex?: boolean;
  /** Languages in which this page really exists (hreflang). Default: all locales. */
  availableLocales?: readonly Locale[];
  /** x-default when the default language is not available (e.g. the record's original language). */
  preferredLocale?: Locale;
}

/** Language-neutral share image (1200×630) in /public — see DEPLOYMENT.md. */
export const SHARE_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: SITE_NAME };

/** Locale-specific title/description, canonical, hreflang alternates and Open Graph tags. */
export function buildMetadata({ locale, path = "", title, description, noindex, availableLocales, preferredLocale }: PageMetadataInput): Metadata {
  const url = absoluteUrl(locale, path);
  return {
    title,
    description,
    alternates: { canonical: url, languages: noindex ? undefined : languageAlternates(path, availableLocales, preferredLocale) },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description,
      url,
      images: [SHARE_IMAGE],
      locale: localeMeta[locale].ogLocale,
      alternateLocale: Object.entries(localeMeta)
        .filter(([key]) => key !== locale)
        .map(([, meta]) => meta.ogLocale),
    },
    twitter: { card: "summary_large_image", title, description, images: [SHARE_IMAGE.url] },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
