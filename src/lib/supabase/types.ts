import type {
  DeadlineType, EducationLevel, FieldOfStudy, FundingPeriod, FundingType, LocationType, OpportunityType,
  OrganizationKind, PublicationStatus, VerificationStatus,
} from "@/types/opportunity";
import type { TranslationStatus } from "@/types/translation";

/**
 * Row shapes exactly as PostgREST returns them (snake_case, JSON types). Only the columns the
 * public roles may read are listed: `verified_by`, `created_by`, `translated_by` and
 * `reviewed_by` are intentionally absent (column-level privileges, migration 5).
 */
export interface OrganizationRow {
  id: string;
  slug: string;
  kind: OrganizationKind;
  name: string;
  country: string | null;
  website_url: string | null;
  logo_path: string | null;
  verified_at: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface OpportunityRow {
  id: string;
  slug: string;
  organization_id: string;
  opportunity_type: OpportunityType;
  other_type_label: string | null;
  location_type: LocationType;
  country: string | null;
  city_id: string | null;
  city_text: string | null;
  education_levels: EducationLevel[];
  eligible_fields: FieldOfStudy[];
  eligible_countries: string[] | null;
  funding_type: FundingType;
  funding_amount: number | null;
  funding_currency: string | null;
  funding_period: FundingPeriod | null;
  funding_percent: number | null;
  participation_fee_amount: number | null;
  participation_fee_currency: string | null;
  application_url: string | null;
  official_source_url: string | null;
  application_start_date: string | null;
  application_deadline: string | null;
  deadline_type: DeadlineType;
  deadline_timezone: string;
  publication_status: PublicationStatus;
  verification_status: VerificationStatus;
  last_verified_at: string | null;
  original_language: string;
  content_version: number;
  is_demo: boolean;
  featured: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranslationRow {
  opportunity_id: string;
  language: string;
  title: string;
  short_description: string | null;
  description: string | null;
  requirements: string | null;
  benefits: string | null;
  eligibility: string | null;
  status: TranslationStatus;
  translated_from: string | null;
  source_version: number;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryLinkRow {
  opportunity_id: string;
  category_code: OpportunityType;
  is_primary: boolean;
}

/** What search_opportunities returns for one page. */
export interface SearchPageRow {
  id: string;
  total_count: number | string;
  page: number;
}

/**
 * Column lists used in every select. `satisfies` guarantees each name exists on the row type;
 * the `Complete…` checks below guarantee no row field is forgotten.
 */
export const ORGANIZATION_COLUMNS = ["id", "slug", "kind", "name", "country", "website_url", "logo_path", "verified_at", "is_demo", "created_at", "updated_at"] as const satisfies readonly (keyof OrganizationRow)[];

export const OPPORTUNITY_COLUMNS = [
  "id", "slug", "organization_id", "opportunity_type", "other_type_label", "location_type", "country", "city_id", "city_text",
  "education_levels", "eligible_fields", "eligible_countries", "funding_type", "funding_amount", "funding_currency", "funding_period",
  "funding_percent", "participation_fee_amount", "participation_fee_currency", "application_url", "official_source_url",
  "application_start_date", "application_deadline", "deadline_type", "deadline_timezone", "publication_status", "verification_status",
  "last_verified_at", "original_language", "content_version", "is_demo", "featured", "published_at", "created_at", "updated_at",
] as const satisfies readonly (keyof OpportunityRow)[];

export const TRANSLATION_COLUMNS = [
  "opportunity_id", "language", "title", "short_description", "description", "requirements", "benefits", "eligibility",
  "status", "translated_from", "source_version", "reviewed_at", "created_at", "updated_at",
] as const satisfies readonly (keyof TranslationRow)[];

export const CATEGORY_LINK_COLUMNS = ["opportunity_id", "category_code", "is_primary"] as const satisfies readonly (keyof CategoryLinkRow)[];

type Missing<Row, Cols extends readonly string[]> = Exclude<keyof Row, Cols[number]>;
export const _completeColumnLists: [Missing<OrganizationRow, typeof ORGANIZATION_COLUMNS>, Missing<OpportunityRow, typeof OPPORTUNITY_COLUMNS>,
  Missing<TranslationRow, typeof TRANSLATION_COLUMNS>, Missing<CategoryLinkRow, typeof CATEGORY_LINK_COLUMNS>] extends [never, never, never, never] ? true : never = true;

// ── The slice of supabase-js the repositories use ───────────────────────────────────────────
// A deliberately narrow interface: the repositories depend on THIS, not on the whole client, so
// they can be tested against a real database without an HTTP layer. The real SupabaseClient
// satisfies it structurally (see lib/supabase/server.ts).

export interface QueryError {
  message: string;
  code?: string;
}
export interface QueryResult<T = unknown> {
  data: T | null;
  error: QueryError | null;
}
export interface SelectQuery extends PromiseLike<QueryResult> {
  in(column: string, values: readonly string[]): SelectQuery;
  eq(column: string, value: string | boolean): SelectQuery;
  order(column: string, options?: { ascending?: boolean }): SelectQuery;
  range(from: number, to: number): SelectQuery;
  maybeSingle(): PromiseLike<QueryResult>;
}
/** delete()/update() builders: filters are chained, awaiting runs the statement (return=minimal). */
export interface MutationQuery extends PromiseLike<QueryResult> {
  eq(column: string, value: string): MutationQuery;
}
export interface SupabaseLike {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<QueryResult>;
  from(table: string): {
    select(columns: string): SelectQuery;
    /** INSERT … ON CONFLICT DO UPDATE (PostgREST upsert). Returns no rows (return=minimal). */
    upsert(values: Record<string, unknown>, options?: { onConflict?: string; ignoreDuplicates?: boolean }): PromiseLike<QueryResult>;
    update(values: Record<string, unknown>): MutationQuery;
    delete(): MutationQuery;
  };
}
