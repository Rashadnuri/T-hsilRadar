import { z } from "zod";
import { isValidTimeZone } from "@/lib/opportunities/deadline";
import { allowsFundingAmount } from "@/lib/opportunities/funding";
import { getLocationIssues } from "@/lib/opportunities/location";
import { isSafeHttpsUrl } from "@/lib/opportunities/source";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "@/lib/opportunities/slug";
import {
  DEADLINE_TYPES,
  EDUCATION_LEVELS,
  FIELDS_OF_STUDY,
  FUNDING_PERIODS,
  FUNDING_TYPES,
  LOCATION_TYPES,
  OPPORTUNITY_TYPES,
  PUBLICATION_STATUSES,
  VERIFICATION_STATUSES,
} from "@/types/opportunity";
import { TRANSLATION_STATUSES } from "@/types/translation";

/**
 * Validation for opportunity data entering the system (admin editor, submissions, imports).
 * Error messages are STABLE CODES (e.g. "deadline_required"), not prose: the UI maps them to
 * localized text, and tests can assert on them.
 */

// ── Primitives ──────────────────────────────────────────────────────────────────────────────

export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, "invalid_country_code");
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "invalid_currency_code");
export const languageCodeSchema = z.string().regex(/^[a-z]{2}$/, "invalid_language_code");
export const slugSchema = z.string().max(SLUG_MAX_LENGTH, "slug_too_long").regex(SLUG_PATTERN, "invalid_slug");
export const httpsUrlSchema = z
  .string()
  .max(2048, "url_too_long")
  .refine(isSafeHttpsUrl, "url_must_be_public_https");
export const isoDateTimeSchema = z.iso.datetime({ offset: true, message: "invalid_datetime" });
export const timeZoneSchema = z.string().refine(isValidTimeZone, "invalid_timezone");

const moneySchema = z.number().finite().positive("amount_must_be_positive").max(1_000_000_000, "amount_too_large");

/** Text that will be rendered as restricted Markdown: raw HTML is rejected outright. */
const RAW_HTML = /<\/?[a-z][^>]*>|<!--/i;
const plainText = (max: number) =>
  z.string().trim().max(max, "text_too_long").refine((v) => !RAW_HTML.test(v), "html_not_allowed");

// ── Translation rows ────────────────────────────────────────────────────────────────────────

export const translationInputSchema = z
  .object({
    language: languageCodeSchema,
    title: plainText(200).min(1, "title_required"),
    shortDescription: plainText(400).nullable().default(null),
    description: plainText(20_000).nullable().default(null),
    requirements: plainText(10_000).nullable().default(null),
    benefits: plainText(10_000).nullable().default(null),
    eligibility: plainText(10_000).nullable().default(null),
    status: z.enum(TRANSLATION_STATUSES),
    translatedFrom: languageCodeSchema.nullable().default(null),
    sourceVersion: z.number().int().min(1).default(1),
  })
  .superRefine((t, ctx) => {
    if (t.status === "original" && t.translatedFrom !== null) {
      ctx.addIssue({ code: "custom", path: ["translatedFrom"], message: "original_cannot_have_source" });
    }
    if (t.status !== "original" && t.translatedFrom === null) {
      ctx.addIssue({ code: "custom", path: ["translatedFrom"], message: "translation_needs_source_language" });
    }
    if (t.translatedFrom === t.language) {
      ctx.addIssue({ code: "custom", path: ["translatedFrom"], message: "cannot_translate_from_itself" });
    }
  });

export type TranslationInput = z.infer<typeof translationInputSchema>;

// ── Canonical opportunity ───────────────────────────────────────────────────────────────────

const opportunityFieldsSchema = z.object({
  slug: slugSchema,
  organizationId: z.string().min(1, "organization_required"),
  opportunityType: z.enum(OPPORTUNITY_TYPES),
  otherTypeLabel: plainText(80).min(1).nullable().default(null),

  locationType: z.enum(LOCATION_TYPES),
  country: countryCodeSchema.nullable().default(null),
  cityId: z.string().min(1).nullable().default(null),
  cityText: plainText(100).min(1).nullable().default(null),

  educationLevels: z.array(z.enum(EDUCATION_LEVELS)).max(EDUCATION_LEVELS.length).default([]),
  eligibleFields: z.array(z.enum(FIELDS_OF_STUDY)).max(FIELDS_OF_STUDY.length).default([]),
  eligibleCountries: z.array(countryCodeSchema).min(1, "eligible_countries_empty_use_null").max(250).nullable().default(null),

  fundingType: z.enum(FUNDING_TYPES).default("not_specified"),
  fundingAmount: moneySchema.nullable().default(null),
  fundingCurrency: currencyCodeSchema.nullable().default(null),
  fundingPeriod: z.enum(FUNDING_PERIODS).nullable().default(null),
  fundingPercent: z.number().int().min(1, "percent_out_of_range").max(100, "percent_out_of_range").nullable().default(null),
  participationFeeAmount: moneySchema.nullable().default(null),
  participationFeeCurrency: currencyCodeSchema.nullable().default(null),

  applicationUrl: httpsUrlSchema.nullable().default(null),
  officialSourceUrl: httpsUrlSchema.nullable().default(null),

  applicationStartDate: isoDateTimeSchema.nullable().default(null),
  applicationDeadline: isoDateTimeSchema.nullable().default(null),
  deadlineType: z.enum(DEADLINE_TYPES).default("unknown"),
  deadlineTimezone: timeZoneSchema.default("Asia/Baku"),

  originalLanguage: languageCodeSchema,
  isDemo: z.boolean().default(false),
  featured: z.boolean().default(false),
});

type OpportunityFields = z.infer<typeof opportunityFieldsSchema>;

/** Cross-field rules shared by drafts and publishable records. */
function refineOpportunity(o: OpportunityFields, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

  if (o.opportunityType === "other" && !o.otherTypeLabel) issue("otherTypeLabel", "other_type_label_required");
  if (o.opportunityType !== "other" && o.otherTypeLabel) issue("otherTypeLabel", "other_type_label_only_for_other");

  for (const code of getLocationIssues(o)) issue(code.startsWith("city") || code === "unknown_city" ? "cityId" : "country", code);

  // Deadlines
  if (o.deadlineType === "fixed" && !o.applicationDeadline) issue("applicationDeadline", "deadline_required");
  if (o.deadlineType !== "fixed" && o.applicationDeadline) issue("applicationDeadline", "deadline_only_for_fixed");
  if (o.applicationStartDate && o.applicationDeadline && Date.parse(o.applicationStartDate) > Date.parse(o.applicationDeadline)) {
    issue("applicationStartDate", "start_after_deadline");
  }

  // Funding
  const hasAmount = o.fundingAmount !== null;
  if (hasAmount && !allowsFundingAmount(o.fundingType)) issue("fundingAmount", "amount_not_allowed_for_funding_type");
  if (hasAmount !== (o.fundingCurrency !== null)) issue("fundingCurrency", "amount_and_currency_go_together");
  if (!hasAmount && o.fundingPeriod !== null) issue("fundingPeriod", "period_requires_amount");
  if (o.fundingPercent !== null && o.fundingType !== "tuition_discount") issue("fundingPercent", "percent_only_for_tuition_discount");
  if ((o.participationFeeAmount !== null) !== (o.participationFeeCurrency !== null)) {
    issue("participationFeeCurrency", "fee_and_currency_go_together");
  }

  // Eligibility
  if (o.eligibleCountries && new Set(o.eligibleCountries).size !== o.eligibleCountries.length) {
    issue("eligibleCountries", "duplicate_countries");
  }
  for (const key of ["educationLevels", "eligibleFields"] as const) {
    if (new Set(o[key]).size !== o[key].length) issue(key, "duplicate_values");
  }
}

/** What an editor/importer submits to create or update an opportunity (status fields are set by the server). */
export const opportunityInputSchema = opportunityFieldsSchema.superRefine(refineOpportunity);
export type OpportunityInput = z.infer<typeof opportunityInputSchema>;

/**
 * A full submission: the canonical fields plus all translation rows, with the multilingual
 * invariants (INTERNATIONALIZATION.md §6):
 *  - exactly one row per language
 *  - exactly one `original` row, in `originalLanguage`
 *  - the original row has a short description (cards need it) and is never a machine status
 */
export const opportunitySubmissionSchema = z
  .object({ opportunity: opportunityInputSchema, translations: z.array(translationInputSchema).min(1, "translation_required") })
  .superRefine(({ opportunity, translations }, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const languages = translations.map((t) => t.language);
    if (new Set(languages).size !== languages.length) issue(["translations"], "duplicate_language");

    const originals = translations.filter((t) => t.status === "original");
    if (originals.length !== 1) issue(["translations"], "exactly_one_original_required");
    const original = originals[0];
    if (original) {
      if (original.language !== opportunity.originalLanguage) issue(["translations"], "original_language_mismatch");
      if (!original.shortDescription) issue(["translations"], "original_short_description_required");
    }
    // Non-original rows must name where they came from; the original language is the only allowed source.
    for (const [i, t] of translations.entries()) {
      if (t.status !== "original" && t.translatedFrom !== null && t.translatedFrom !== opportunity.originalLanguage) {
        issue(["translations", i, "translatedFrom"], "translate_from_original_language");
      }
    }
  });
export type OpportunitySubmission = z.infer<typeof opportunitySubmissionSchema>;

// ── Status updates ──────────────────────────────────────────────────────────────────────────

export const statusUpdateSchema = z.object({
  publicationStatus: z.enum(PUBLICATION_STATUSES).optional(),
  verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
});
export type StatusUpdate = z.infer<typeof statusUpdateSchema>;

/** Verification checklist stored with each verification record (SECURITY.md §5). */
export const verificationChecklistSchema = z.object({
  sourceIsOfficial: z.boolean(),
  organizationIdentityConfirmed: z.boolean(),
  deadlineMatchesSource: z.boolean(),
  noFeeOrScamSigns: z.boolean(),
  linksWork: z.boolean(),
});
/** A record can only be marked verified when every checklist item is true. */
export const verifiedOutcomeSchema = verificationChecklistSchema.refine((c) => Object.values(c).every(Boolean), "checklist_incomplete");
