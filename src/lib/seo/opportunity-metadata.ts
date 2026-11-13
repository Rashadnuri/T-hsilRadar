import type { Metadata } from "next";
import type { Locale } from "@/i18n/routing";
import { routing } from "@/i18n/routing";
import { buildMetadata } from "@/lib/metadata";
import { resolveContent } from "@/lib/opportunities/translations";
import type { OpportunityRecord } from "@/types/opportunity";

export const DESCRIPTION_MAX = 160;

/** Cuts at a word boundary and adds "…" (search engines show about 155–160 characters). */
export function truncateDescription(text: string, max = DESCRIPTION_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), Math.floor(max * 0.6))).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/**
 * Metadata of an opportunity page.
 *  - title/description come from the page language; when the record has no short description the
 *    description is taken from the full text, and only then from the title;
 *  - demo records and pages that fall back to another language are `noindex` (and carry no hreflang);
 *  - hreflang lists only the languages in which the page really exists, never a noindex fallback.
 */
export function buildOpportunityMetadata(o: OpportunityRecord, locale: Locale): Metadata {
  const content = resolveContent(o, locale);
  const text = content.shortDescription?.value ?? content.description?.value ?? content.title.value;
  return buildMetadata({
    locale,
    path: `/opportunities/${o.slug}`,
    title: content.title.value,
    description: truncateDescription(text),
    noindex: o.isDemo || !content.isFullyInRequestedLanguage,
    availableLocales: routing.locales.filter((l) => resolveContent(o, l).isFullyInRequestedLanguage),
    preferredLocale: routing.locales.find((l) => l === o.originalLanguage),
  });
}
