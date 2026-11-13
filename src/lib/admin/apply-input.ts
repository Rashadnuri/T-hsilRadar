import type { OpportunityFormInput } from "@/types/admin";
import type { OpportunityRecord } from "@/types/opportunity";
import type { OpportunityTranslation } from "@/types/translation";

/**
 * What a record WOULD look like after saving `input` (pure preview). Used to answer, before
 * anything is written: "does this edit change facts the verification vouches for?" and "would a
 * published record still meet the publishing requirements?". The database re-checks both.
 */
export function applyInputToRecord(record: OpportunityRecord, input: OpportunityFormInput): OpportunityRecord {
  const original = input.translations.find((t) => t.status === "original");
  const translations: OpportunityTranslation[] = record.translations.map((t) => {
    if (t.status !== "original" || !original) return t;
    return { ...t, title: original.title, shortDescription: original.shortDescription, description: original.description, requirements: original.requirements, benefits: original.benefits, eligibility: original.eligibility };
  });
  return {
    ...record,
    slug: input.slug,
    organizationId: input.organizationId,
    opportunityType: input.opportunityType,
    otherTypeLabel: input.otherTypeLabel,
    locationType: input.locationType,
    country: input.country,
    cityId: input.cityId,
    cityText: input.cityText,
    educationLevels: input.educationLevels,
    eligibleFields: input.eligibleFields,
    eligibleCountries: input.eligibleCountries,
    fundingType: input.fundingType,
    fundingAmount: input.fundingAmount,
    fundingCurrency: input.fundingCurrency,
    fundingPeriod: input.fundingPeriod,
    fundingPercent: input.fundingPercent,
    participationFeeAmount: input.participationFeeAmount,
    participationFeeCurrency: input.participationFeeCurrency,
    applicationUrl: input.applicationUrl,
    officialSourceUrl: input.officialSourceUrl,
    applicationStartDate: input.applicationStartDate,
    applicationDeadline: input.applicationDeadline,
    deadlineType: input.deadlineType,
    deadlineTimezone: input.deadlineTimezone,
    featured: input.featured,
    organization: record.organization.id === input.organizationId ? record.organization : { ...record.organization, id: input.organizationId },
    translations,
  };
}
