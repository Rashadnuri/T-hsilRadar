import type { Opportunity, OpportunityRecord, Organization } from "@/types/opportunity";
import type { OpportunityTranslation } from "@/types/translation";
import type { CategoryLinkRow, OpportunityRow, OrganizationRow, TranslationRow } from "@/lib/supabase/types";

/** Database rows (snake_case) → domain objects (camelCase). The only place names are translated. */

export function mapOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    country: row.country,
    websiteUrl: row.website_url,
    isDemo: row.is_demo,
  };
}

export function mapTranslation(row: TranslationRow): OpportunityTranslation {
  return {
    opportunityId: row.opportunity_id,
    language: row.language,
    title: row.title,
    shortDescription: row.short_description,
    description: row.description,
    requirements: row.requirements,
    benefits: row.benefits,
    eligibility: row.eligibility,
    status: row.status,
    translatedFrom: row.translated_from,
    sourceVersion: row.source_version,
    // Staff identities are not readable by public roles, so they are never present here.
    translatedBy: null,
    reviewedBy: null,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapOpportunity(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    slug: row.slug,
    organizationId: row.organization_id,
    opportunityType: row.opportunity_type,
    otherTypeLabel: row.other_type_label,
    locationType: row.location_type,
    country: row.country,
    cityId: row.city_id,
    cityText: row.city_text,
    educationLevels: row.education_levels,
    eligibleFields: row.eligible_fields,
    eligibleCountries: row.eligible_countries,
    fundingType: row.funding_type,
    fundingAmount: row.funding_amount,
    fundingCurrency: row.funding_currency,
    fundingPeriod: row.funding_period,
    fundingPercent: row.funding_percent,
    participationFeeAmount: row.participation_fee_amount,
    participationFeeCurrency: row.participation_fee_currency,
    applicationUrl: row.application_url,
    officialSourceUrl: row.official_source_url,
    applicationStartDate: row.application_start_date,
    applicationDeadline: row.application_deadline,
    deadlineType: row.deadline_type,
    deadlineTimezone: row.deadline_timezone,
    publicationStatus: row.publication_status,
    verificationStatus: row.verification_status,
    lastVerifiedAt: row.last_verified_at,
    // Not readable by public roles (column privileges); the verification STATUS is what matters.
    verifiedBy: null,
    originalLanguage: row.original_language,
    contentVersion: row.content_version,
    isDemo: row.is_demo,
    featured: row.featured,
    publishedAt: row.published_at,
    createdBy: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Primary category first, then the rest alphabetically (stable). */
export function mapCategories(opportunityType: OpportunityRow["opportunity_type"], links: CategoryLinkRow[]): OpportunityRecord["categories"] {
  const rest = links.filter((l) => !l.is_primary && l.category_code !== opportunityType).map((l) => l.category_code).sort();
  return [opportunityType, ...rest];
}

export function mapOpportunityRecord(
  row: OpportunityRow,
  organization: Organization,
  translationRows: TranslationRow[],
  linkRows: CategoryLinkRow[],
): OpportunityRecord {
  return {
    ...mapOpportunity(row),
    organization,
    translations: translationRows.map(mapTranslation),
    categories: mapCategories(row.opportunity_type, linkRows),
  };
}
