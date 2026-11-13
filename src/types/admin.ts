import type {
  DeadlineType, EducationLevel, FieldOfStudy, FundingPeriod, FundingType, LocationType, OpportunityRecord, OpportunityType, OrganizationKind,
  PublicationStatus, VerificationStatus,
} from "./opportunity";

/** Roles are DATA (table user_roles), granted only by the operator — never by the API. */
export const APP_ROLES = ["admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** The five statuses the admin works with (the legacy "unpublished" is shown but cannot be chosen). */
export const ADMIN_PUBLICATION_STATUSES = ["draft", "in_review", "published", "rejected", "archived"] as const satisfies readonly PublicationStatus[];
export type AdminPublicationStatus = (typeof ADMIN_PUBLICATION_STATUSES)[number];

/** Admins see two verification states; "rejected"/"expired" are derived (see getEffectiveVerificationStatus). */
export const ADMIN_VERIFICATION_STATES = ["verified", "unverified"] as const satisfies readonly VerificationStatus[];
export type AdminVerificationState = (typeof ADMIN_VERIFICATION_STATES)[number];

/** Languages an admin writes translations for. The ORIGINAL may be in any language (a German page keeps its German text). */
export const TRANSLATION_LANGUAGES = ["az", "ru", "en"] as const;
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

/** Statuses an admin can give a non-original translation when saving. Approval of a machine draft is a separate, explicit action. */
export const EDITABLE_TRANSLATION_STATUSES = ["human", "machine_draft"] as const;
export type EditableTranslationStatus = (typeof EDITABLE_TRANSLATION_STATUSES)[number];

export interface TranslationInput {
  language: string;
  title: string;
  shortDescription: string | null;
  description: string | null;
  requirements: string | null;
  benefits: string | null;
  eligibility: string | null;
  /** "original" for the original-language row. */
  status: "original" | EditableTranslationStatus;
}

export interface OpportunityFormInput {
  /** Present when editing. */
  id?: string;
  slug: string;
  organizationId: string;
  opportunityType: OpportunityType;
  otherTypeLabel: string | null;
  locationType: LocationType;
  country: string | null;
  cityId: string | null;
  cityText: string | null;
  educationLevels: EducationLevel[];
  eligibleFields: FieldOfStudy[];
  /** null = not stated. */
  eligibleCountries: string[] | null;
  fundingType: FundingType;
  fundingAmount: number | null;
  fundingCurrency: string | null;
  fundingPeriod: FundingPeriod | null;
  fundingPercent: number | null;
  participationFeeAmount: number | null;
  participationFeeCurrency: string | null;
  applicationUrl: string | null;
  officialSourceUrl: string | null;
  applicationStartDate: string | null;
  applicationDeadline: string | null;
  deadlineType: DeadlineType;
  deadlineTimezone: string;
  /** Fixed at creation; the original text is preserved in this language. */
  originalLanguage: string;
  featured: boolean;
  /** Provenance of imported records (set on creation only; imported records are always drafts). */
  sourceId?: string | null;
  importBatch?: string | null;
  translations: TranslationInput[];
  /** Non-original languages to delete. */
  removeLanguages: string[];
}

export interface OrganizationFormInput {
  id?: string;
  slug: string;
  kind: OrganizationKind;
  name: string;
  country: string | null;
  websiteUrl: string | null;
}

export interface AdminListFilters {
  status?: PublicationStatus;
  verification?: "verified" | "unverified" | "expired";
  expired?: boolean;
  organizationId?: string;
  /** Records created by one import batch / by any import. */
  batch?: string;
  imported?: boolean;
  q?: string;
  page: number;
}

export interface AdminListResult {
  items: OpportunityRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DashboardStats {
  total: number;
  byStatus: Partial<Record<PublicationStatus, number>>;
  unverified: number;
  expired: number;
  missingTranslations: number;
  organizations: number;
}

export const ADMIN_PAGE_SIZE = 20;

export interface ImportBatchSummary {
  batch: string;
  total: number;
  draft: number;
  inReview: number;
  published: number;
  other: number;
  lastAt: string;
}

/** Ids needing attention (each list is capped at 100 by the database function). */
export interface QualityReport {
  expiredUnflagged: string[];
  staleVerification: string[];
  sourcesOverdue: string[];
  publishedMissingTranslations: string[];
}
