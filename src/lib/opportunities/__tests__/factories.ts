import type { OpportunityRecord, Organization } from "@/types/opportunity";
import type { OpportunityTranslation } from "@/types/translation";

const NOW = "2026-06-01T00:00:00.000Z";

export const ORG: Organization = {
  id: "org-1", slug: "org-1", name: "Test Org", kind: "university", country: "AZ", websiteUrl: "https://org.example.com", isDemo: false,
};

export function makeTranslation(overrides: Partial<OpportunityTranslation> & Pick<OpportunityTranslation, "language">): OpportunityTranslation {
  return {
    opportunityId: "opp-1", status: "human", title: "Title", shortDescription: "Short", description: null, requirements: null,
    benefits: null, eligibility: null, translatedFrom: "az", sourceVersion: 1, translatedBy: null, reviewedBy: null,
    reviewedAt: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

/** A valid, verified, published Azerbaijani-original record with an az original and nothing else. */
export function makeRecord(overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return {
    id: "opp-1", slug: "test-opportunity", organizationId: ORG.id, organization: ORG,
    opportunityType: "scholarship", otherTypeLabel: null,
    locationType: "onsite", country: "AZ", cityId: "baku", cityText: null,
    educationLevels: ["bachelor"], eligibleFields: [], eligibleCountries: null,
    fundingType: "fully_funded", fundingAmount: null, fundingCurrency: null, fundingPeriod: null, fundingPercent: null,
    participationFeeAmount: null, participationFeeCurrency: null,
    applicationUrl: "https://org.example.com/apply", officialSourceUrl: "https://org.example.com/program",
    applicationStartDate: null, applicationDeadline: "2026-12-31T19:59:59.999Z", deadlineType: "fixed", deadlineTimezone: "Asia/Baku",
    publicationStatus: "published", verificationStatus: "verified", lastVerifiedAt: "2026-05-20T00:00:00.000Z", verifiedBy: "mod-1",
    originalLanguage: "az", contentVersion: 1, isDemo: false, featured: false, publishedAt: NOW, createdBy: null, createdAt: NOW, updatedAt: NOW,
    translations: [makeTranslation({ language: "az", status: "original", translatedFrom: null, title: "Başlıq", shortDescription: "Qısa" })],
    categories: ["scholarship"],
    ...overrides,
    // Unless set explicitly, the categories follow the (possibly overridden) primary type.
    ...(overrides.categories ? {} : { categories: [overrides.opportunityType ?? "scholarship"] }),
  };
}
