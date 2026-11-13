/**
 * Translation model (DATA_MODEL.md §4.2, INTERNATIONALIZATION.md §6).
 * One row per (opportunity, language). Rows may be INCOMPLETE: only `title` is mandatory, and
 * a missing field is NULL — it is never filled with generated text.
 */

/** ISO 639-1 (two letters) language code, lower-case: "az", "ru", "en", "de", "tr"… */
export type LanguageCode = string;

export const TRANSLATABLE_FIELDS = ["title", "shortDescription", "description", "requirements", "benefits", "eligibility"] as const;
export type TranslatableField = (typeof TRANSLATABLE_FIELDS)[number];

/**
 *  - original:          text of the official source, in its own language
 *  - human:             translated and reviewed by a person
 *  - machine_draft:     machine output, unreviewed → NEVER public
 *  - machine_approved:  machine output approved by a moderator → public, labelled "machine-translated"
 *  - outdated:          the original changed after this was written → public with a notice
 */
export const TRANSLATION_STATUSES = ["original", "human", "machine_draft", "machine_approved", "outdated"] as const;
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];

export interface TranslationContent {
  title: string;
  shortDescription: string | null;
  /** Full description (restricted Markdown, sanitized on render). */
  description: string | null;
  requirements: string | null;
  benefits: string | null;
  /** Human-readable eligibility information (the structured rules live on the opportunity). */
  eligibility: string | null;
}

export interface OpportunityTranslation extends TranslationContent {
  opportunityId: string;
  language: LanguageCode;
  status: TranslationStatus;
  /** Language this text was translated from (null for originals). */
  translatedFrom: LanguageCode | null;
  /** `Opportunity.contentVersion` this translation was written against. */
  sourceVersion: number;
  translatedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One field of resolved (display-ready) content, with the language it is actually written in. */
export interface ResolvedField {
  value: string;
  /** Language of `value`. Render with lang="{language}" and label it when `isFallback`. */
  language: LanguageCode;
  /** True when `language` differs from the requested language. */
  isFallback: boolean;
  status: TranslationStatus;
}

export interface ResolvedContent {
  requestedLanguage: LanguageCode;
  originalLanguage: LanguageCode;
  title: ResolvedField;
  shortDescription: ResolvedField | null;
  description: ResolvedField | null;
  requirements: ResolvedField | null;
  benefits: ResolvedField | null;
  eligibility: ResolvedField | null;
  /** Fields shown in a language other than the requested one (requested text missing or not public). */
  fallbackFields: TranslatableField[];
  /** Fields with no text in any public language. They are omitted, never invented. */
  missingFields: TranslatableField[];
  /** Distinct languages used on the page. */
  languagesUsed: LanguageCode[];
  /** True when nothing had to fall back. */
  isFullyInRequestedLanguage: boolean;
  /** Some shown text is machine-translated (needs the "machine-translated" notice). */
  hasMachineTranslation: boolean;
  /** Some shown text is from an outdated translation (needs the "may be outdated" notice). */
  hasOutdatedTranslation: boolean;
}
