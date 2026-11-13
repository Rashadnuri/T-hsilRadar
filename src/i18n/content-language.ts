import type { LanguageCode } from "@/types/translation";
import { localeMeta } from "./locales";
import { locales, type Locale } from "./routing";

/**
 * Content languages vs. interface locales:
 *  - interface locales are the three the UI is translated into (az, ru, en);
 *  - content languages are ANY ISO 639-1 code, because a German university's official text is
 *    German and must be preserved as the original even though the UI has no German version.
 */

const LANGUAGE_RE = /^[a-z]{2}$/;

/** "ru-RU" / "RU" / " ru " → "ru". Returns null when the input is not a plausible language. */
export function normalizeLanguage(input: string | null | undefined): LanguageCode | null {
  if (!input) return null;
  const primary = input.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return LANGUAGE_RE.test(primary) ? primary : null;
}

export function isInterfaceLocale(language: string): language is Locale {
  return (locales as readonly string[]).includes(language);
}

/**
 * Languages to try for an opportunity's text, in order. Deliberately SHORT: the requested
 * language, then the original. We never chain through other translations (en → ru → az),
 * because a secondary translation could be stale or lower quality and look authoritative
 * (INTERNATIONALIZATION.md §6.3).
 */
export function getContentFallbackChain(requested: LanguageCode, original: LanguageCode): LanguageCode[] {
  return requested === original ? [requested] : [requested, original];
}

/** A language's name written in that language ("Deutsch", "Azərbaycanca"), for labelling fallback text. */
export function getLanguageName(language: LanguageCode): string {
  if (isInterfaceLocale(language)) return localeMeta[language].nativeName;
  try {
    const name = new Intl.DisplayNames([language], { type: "language" }).of(language);
    if (name && name !== language) return name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
  } catch {
    // Unknown language tag: fall through to the code.
  }
  return language.toUpperCase();
}

/** Short badge text: "AZ", "DE". */
export function getLanguageBadge(language: LanguageCode): string {
  return isInterfaceLocale(language) ? localeMeta[language].code : language.toUpperCase();
}
