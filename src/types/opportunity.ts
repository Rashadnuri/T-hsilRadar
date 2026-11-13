import type { LanguageCode, OpportunityTranslation } from "./translation";

/**
 * Canonical domain model for opportunities (DATA_MODEL.md §4).
 *
 * ONE opportunity = ONE canonical record. Language-neutral facts live here; all human-readable
 * text lives in `OpportunityTranslation` rows (types/translation.ts). There are never separate
 * opportunity records per language.
 *
 * TypeScript uses camelCase; the database uses the snake_case equivalents named in DATA_MODEL.md.
 */

// ── Controlled vocabularies (stable codes; labels live in the message files) ────────────────

export const OPPORTUNITY_TYPES = [
  "scholarship",
  "internship",
  "grant",
  "admission",
  "exchange",
  "training",
  "certification",
  "summer_school",
  "hackathon",
  "competition",
  "research",
  "other",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

/** Where participation happens. Maps to the "Remote / Hybrid / Onsite" requirement. */
export const LOCATION_TYPES = ["onsite", "remote", "hybrid"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

/**
 * What the opportunity gives the participant (never what the participant pays):
 *  - fully_funded:     all main costs covered (tuition, living, travel as applicable)
 *  - partially_funded: some costs covered
 *  - paid:             the participant receives pay (salary, stipend, prize-style compensation)
 *  - unpaid:           no pay and no funding
 *  - tuition_discount: reduced tuition/fees (percent and/or amount)
 *  - not_specified:    the source says nothing; never guess
 * A participation fee that the participant must pay is a separate field (`participationFee`).
 */
export const FUNDING_TYPES = ["fully_funded", "partially_funded", "paid", "unpaid", "tuition_discount", "not_specified"] as const;
export type FundingType = (typeof FUNDING_TYPES)[number];

export const FUNDING_PERIODS = ["total", "monthly", "yearly"] as const;
export type FundingPeriod = (typeof FUNDING_PERIODS)[number];

/**
 * Trust state of the data.
 *  - unverified: not checked yet, or critical fields changed since the last check
 *  - verified:   a moderator confirmed the official source and key facts (verifiedAt/By set)
 *  - rejected:   checked and refused (scam, wrong, unverifiable)
 *  - expired:    the opportunity has ended; set by the expiry job. Display logic never relies on
 *                this alone: a passed deadline also means expired (see lib/opportunities/deadline).
 */
export const VERIFICATION_STATUSES = ["verified", "unverified", "rejected", "expired"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Editorial visibility, independent from verification (DATA_MODEL.md §5). */
export const PUBLICATION_STATUSES = ["draft", "in_review", "published", "rejected", "unpublished", "archived"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** `fixed` needs a deadline; `rolling` has none by design; `unknown` means the source does not say. */
export const DEADLINE_TYPES = ["fixed", "rolling", "unknown"] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];

export const EDUCATION_LEVELS = ["high_school", "bachelor", "master", "phd", "graduate", "professional"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

/** Broad fields of study, following ISCED-F 2013 "broad fields" (11). */
export const FIELDS_OF_STUDY = [
  "education",
  "arts_humanities",
  "social_sciences",
  "business_law",
  "natural_sciences",
  "ict",
  "engineering",
  "agriculture",
  "health",
  "services",
  "general",
] as const;
export type FieldOfStudy = (typeof FIELDS_OF_STUDY)[number];

export const ORGANIZATION_KINDS = ["government", "university", "bank", "company", "it_company", "ngo", "international_org", "scholarship_org", "development_org"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

/** Derived market segment (see deriveMarketScope); used for the Azerbaijan / International views. */
export const MARKET_SCOPES = ["azerbaijan", "international", "both"] as const;
export type MarketScope = (typeof MARKET_SCOPES)[number];

/**
 *  - open:    can apply now as far as we know (open, closing soon or rolling)
 *  - week/month: fixed deadline within 7 / 30 days
 *  - rolling: rolling admission (no deadline)
 *  - expired: ended — the ONLY way expired opportunities enter the catalogue (they never show as active)
 */
/** Verification states a visitor can filter by. "rejected" is omitted: rejected records are never public. */
export const VERIFICATION_FILTERS = ["verified", "unverified", "expired"] as const;
export type VerificationFilter = (typeof VERIFICATION_FILTERS)[number];

export const DEADLINE_FILTERS = ["open", "week", "month", "rolling", "expired"] as const;
export type DeadlineFilter = (typeof DEADLINE_FILTERS)[number];

/** newest = publication date; deadline = approaching first; updated = last edit; relevance only with a search query. */
export const SORT_OPTIONS = ["relevance", "newest", "deadline", "updated"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

// ── Scalars ─────────────────────────────────────────────────────────────────────────────────

/** ISO 3166-1 alpha-2, upper-case ("AZ", "DE"). */
export type CountryCode = string;
/** ISO 4217 currency code, upper-case ("AZN", "EUR"). */
export type CurrencyCode = string;
/** RFC 3339 timestamp, e.g. "2027-03-01T19:59:59.999Z". */
export type ISODateTime = string;

// ── Entities ────────────────────────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  slug: string;
  /** Official name in its original language; never machine-translated (INTERNATIONALIZATION.md §6.4). */
  name: string;
  kind: OrganizationKind;
  country: CountryCode | null;
  websiteUrl: string | null;
  isDemo: boolean;
}

export interface Opportunity {
  id: string;
  /** Stable, ASCII, language-neutral; identical in every locale URL. */
  slug: string;
  organizationId: string;

  opportunityType: OpportunityType;
  /** Required when `opportunityType` is "other". Free text in the original language. */
  otherTypeLabel: string | null;

  // Location
  locationType: LocationType;
  /** Host country; null only for remote opportunities with no host country. */
  country: CountryCode | null;
  /** Reference to a known city (lib/opportunities/cities). */
  cityId: string | null;
  /** City exactly as published, for cities not in the reference list. */
  cityText: string | null;

  // Eligibility (structured, language-neutral)
  educationLevels: EducationLevel[];
  /** Empty = not restricted / not stated. */
  eligibleFields: FieldOfStudy[];
  /** null = not stated (nobody is excluded); otherwise only these nationalities/residents. */
  eligibleCountries: CountryCode[] | null;

  // Funding
  fundingType: FundingType;
  /** Amount provided to the participant, in `fundingCurrency` per `fundingPeriod`. */
  fundingAmount: number | null;
  fundingCurrency: CurrencyCode | null;
  fundingPeriod: FundingPeriod | null;
  /** Only for "tuition_discount": 1–100. */
  fundingPercent: number | null;
  /** What the participant must pay to take part (summer school fee, exam fee…). */
  participationFeeAmount: number | null;
  participationFeeCurrency: CurrencyCode | null;

  // Links
  /** Where to apply. */
  applicationUrl: string | null;
  /** The organization's own page that states the facts. Required to publish. */
  officialSourceUrl: string | null;

  // Dates
  applicationStartDate: ISODateTime | null;
  applicationDeadline: ISODateTime | null;
  deadlineType: DeadlineType;
  /** IANA zone the deadline is expressed in (default Asia/Baku). */
  deadlineTimezone: string;

  // Status
  publicationStatus: PublicationStatus;
  verificationStatus: VerificationStatus;
  lastVerifiedAt: ISODateTime | null;
  verifiedBy: string | null;

  // Language
  /** Language of the official source text; ANY ISO 639-1 code (a German page is "de"). */
  originalLanguage: LanguageCode;
  /** Incremented when original-language text changes; translations record which version they follow. */
  contentVersion: number;

  // Flags & audit
  isDemo: boolean;
  featured: boolean;
  publishedAt: ISODateTime | null;
  createdBy: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Canonical record joined with its organization and all translation rows (read model). */
export interface OpportunityRecord extends Opportunity {
  organization: Organization;
  translations: OpportunityTranslation[];
  /**
   * All categories of the opportunity, PRIMARY FIRST (always starts with `opportunityType`).
   * Backed by the opportunity_categories join table; most records have exactly one.
   */
  categories: OpportunityType[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
