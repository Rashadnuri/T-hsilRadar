import { getContentFallbackChain } from "@/i18n/content-language";
import type { OpportunityRecord } from "@/types/opportunity";
import {
  TRANSLATABLE_FIELDS,
  type LanguageCode,
  type OpportunityTranslation,
  type ResolvedContent,
  type ResolvedField,
  type TranslatableField,
  type TranslationStatus,
} from "@/types/translation";

/** Statuses a visitor may see. `machine_draft` is internal-only. */
export const PUBLIC_TRANSLATION_STATUSES: readonly TranslationStatus[] = ["original", "human", "machine_approved", "outdated"];

export const isPublicTranslation = (t: Pick<OpportunityTranslation, "status">) => PUBLIC_TRANSLATION_STATUSES.includes(t.status);

type Translated = Pick<OpportunityRecord, "translations" | "originalLanguage" | "slug">;

export function getTranslation(record: Pick<OpportunityRecord, "translations">, language: LanguageCode) {
  return record.translations.find((t) => t.language === language);
}

/** The canonical source text: the row written in `originalLanguage`. */
export function getOriginalTranslation(record: Pick<OpportunityRecord, "translations" | "originalLanguage">) {
  return record.translations.find((t) => t.language === record.originalLanguage && t.status === "original");
}

const clean = (value: string | null | undefined) => (value && value.trim() !== "" ? value : null);

/**
 * Resolves display text for `requested`, FIELD BY FIELD:
 *   requested-language text (if the row is public and the field is non-empty)
 *   → else the original-language text
 *   → else nothing (the field is omitted; nothing is ever generated).
 * Every resolved field says which language it is in, so the UI can set `lang` and label fallbacks.
 */
export function resolveContent(record: Translated, requested: LanguageCode): ResolvedContent {
  const chain = getContentFallbackChain(requested, record.originalLanguage);
  const rows = chain.flatMap((language) => {
    const row = record.translations.find((t) => t.language === language);
    return row && isPublicTranslation(row) ? [row] : [];
  });

  const resolveField = (field: TranslatableField): ResolvedField | null => {
    for (const row of rows) {
      const value = clean(row[field]);
      if (value) return { value, language: row.language, isFallback: row.language !== requested, status: row.status };
    }
    return null;
  };

  const resolved = Object.fromEntries(TRANSLATABLE_FIELDS.map((f) => [f, resolveField(f)])) as Record<TranslatableField, ResolvedField | null>;

  // Defensive: a record without any public title (corrupt data) still renders, labelled as its slug.
  const title: ResolvedField = resolved.title ?? {
    value: record.slug,
    language: record.originalLanguage,
    isFallback: record.originalLanguage !== requested,
    status: "original",
  };

  const present = TRANSLATABLE_FIELDS.filter((f) => (f === "title" ? true : resolved[f] !== null));
  const shown = present.map((f) => (f === "title" ? title : (resolved[f] as ResolvedField)));
  const fallbackFields = present.filter((_, i) => shown[i]!.isFallback);

  return {
    requestedLanguage: requested,
    originalLanguage: record.originalLanguage,
    title,
    shortDescription: resolved.shortDescription,
    description: resolved.description,
    requirements: resolved.requirements,
    benefits: resolved.benefits,
    eligibility: resolved.eligibility,
    fallbackFields,
    missingFields: TRANSLATABLE_FIELDS.filter((f) => f !== "title" && resolved[f] === null),
    languagesUsed: [...new Set(shown.map((s) => s.language))],
    isFullyInRequestedLanguage: fallbackFields.length === 0,
    hasMachineTranslation: shown.some((s) => s.status === "machine_approved"),
    hasOutdatedTranslation: shown.some((s) => s.status === "outdated"),
  };
}

/** Languages with publicly visible text, original first. Drives the language chips on cards. */
export function getAvailableLanguages(record: Pick<OpportunityRecord, "translations" | "originalLanguage">): LanguageCode[] {
  const languages = record.translations.filter(isPublicTranslation).map((t) => t.language);
  return [...new Set([record.originalLanguage, ...languages])].filter((l) => languages.includes(l));
}

/** Is the translation complete relative to the original (every field the original has)? */
export function isTranslationComplete(record: Pick<OpportunityRecord, "translations" | "originalLanguage">, language: LanguageCode): boolean {
  const original = getOriginalTranslation(record);
  const row = getTranslation(record, language);
  if (!original || !row) return false;
  return TRANSLATABLE_FIELDS.every((f) => !clean(original[f]) || Boolean(clean(row[f])));
}

/** Per-language coverage for the admin editor and the "% translated" metric. */
export function getTranslationCoverage(record: Pick<OpportunityRecord, "translations" | "originalLanguage">, languages: readonly LanguageCode[]) {
  return languages.map((language) => {
    const row = getTranslation(record, language);
    const original = getOriginalTranslation(record);
    const expected = original ? TRANSLATABLE_FIELDS.filter((f) => clean(original[f])) : [];
    const done = row ? expected.filter((f) => clean(row[f])) : [];
    return {
      language,
      status: row?.status ?? null,
      isPublic: row ? isPublicTranslation(row) : false,
      filled: done.length,
      expected: expected.length,
      missingFields: expected.filter((f) => !done.includes(f)),
    };
  });
}

/** A human/machine translation written against an older version of the original text. */
export function isTranslationOutdated(t: Pick<OpportunityTranslation, "status" | "sourceVersion">, contentVersion: number): boolean {
  return t.status !== "original" && t.sourceVersion < contentVersion;
}

/**
 * Call when the ORIGINAL text changes: bumps the version and marks reviewed translations as
 * `outdated` (they stay public with a notice until updated). Drafts are left as drafts.
 * Pure: returns new objects.
 */
export function applyOriginalEdit<T extends Pick<OpportunityRecord, "translations" | "contentVersion">>(record: T): T {
  const contentVersion = record.contentVersion + 1;
  const translations = record.translations.map((t) => {
    if (t.status === "original") return { ...t, sourceVersion: contentVersion };
    return t.status === "human" || t.status === "machine_approved" ? { ...t, status: "outdated" as const } : t;
  });
  return { ...record, contentVersion, translations };
}
