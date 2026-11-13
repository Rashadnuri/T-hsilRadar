import { describe, expect, it } from "vitest";
import type { CategoryLinkRow, OpportunityRow, OrganizationRow, TranslationRow } from "@/lib/supabase/types";
import { mapCategories, mapOpportunityRecord, mapOrganization, mapTranslation } from "./mappers";

const org: OrganizationRow = { id: "o1", slug: "org", kind: "university", name: "Org", country: "AZ", website_url: "https://org.example.com", logo_path: null, verified_at: null, is_demo: false, created_at: "2026-01-01T00:00:00+00:00", updated_at: "2026-01-01T00:00:00+00:00" };
const row: OpportunityRow = {
  id: "p1", slug: "prog", organization_id: "o1", opportunity_type: "grant", other_type_label: null, location_type: "hybrid", country: "AZ", city_id: "sumgait", city_text: null,
  education_levels: ["bachelor"], eligible_fields: ["ict"], eligible_countries: null, funding_type: "paid", funding_amount: 800, funding_currency: "AZN", funding_period: "monthly", funding_percent: null,
  participation_fee_amount: null, participation_fee_currency: null, application_url: "https://org.example.com/apply", official_source_url: "https://org.example.com/p",
  application_start_date: null, application_deadline: "2027-03-01T19:59:59.999+00:00", deadline_type: "fixed", deadline_timezone: "Asia/Baku", publication_status: "published",
  verification_status: "verified", last_verified_at: "2026-05-01T00:00:00+00:00", original_language: "de", content_version: 3, is_demo: false, featured: true,
  published_at: "2026-05-02T00:00:00+00:00", created_at: "2026-05-01T00:00:00+00:00", updated_at: "2026-05-03T00:00:00+00:00",
};
const tr: TranslationRow = { opportunity_id: "p1", language: "az", title: "Başlıq", short_description: null, description: null, requirements: null, benefits: null, eligibility: null, status: "human", translated_from: "de", source_version: 2, reviewed_at: null, created_at: "2026-05-01T00:00:00+00:00", updated_at: "2026-05-01T00:00:00+00:00" };

describe("row → domain mapping", () => {
  it("maps an organization", () => {
    expect(mapOrganization(org)).toEqual({ id: "o1", slug: "org", name: "Org", kind: "university", country: "AZ", websiteUrl: "https://org.example.com", isDemo: false });
  });
  it("maps a translation, keeping missing fields NULL (incomplete translations stay incomplete) and never inventing staff ids", () => {
    const t = mapTranslation(tr);
    expect(t).toMatchObject({ opportunityId: "p1", language: "az", title: "Başlıq", shortDescription: null, description: null, status: "human", translatedFrom: "de", sourceVersion: 2 });
    expect(t.translatedBy).toBeNull();
    expect(t.reviewedBy).toBeNull();
  });
  it("maps a full record: camelCase, numbers, arrays, preserved original language", () => {
    const r = mapOpportunityRecord(row, mapOrganization(org), [tr], [{ opportunity_id: "p1", category_code: "grant", is_primary: true }]);
    expect(r).toMatchObject({
      id: "p1", organizationId: "o1", opportunityType: "grant", locationType: "hybrid", cityId: "sumgait", fundingType: "paid", fundingAmount: 800, fundingCurrency: "AZN",
      fundingPeriod: "monthly", educationLevels: ["bachelor"], eligibleFields: ["ict"], eligibleCountries: null, deadlineType: "fixed", deadlineTimezone: "Asia/Baku",
      verificationStatus: "verified", originalLanguage: "de", contentVersion: 3, featured: true, categories: ["grant"],
    });
    expect(r.verifiedBy).toBeNull(); // moderator identity is not readable by public roles
    expect(r.createdBy).toBeNull();
    expect(r.organization.name).toBe("Org");
    expect(r.translations).toHaveLength(1);
  });
  it("categories: primary first, then the rest alphabetically, without duplicates", () => {
    const links: CategoryLinkRow[] = [
      { opportunity_id: "p1", category_code: "research", is_primary: false },
      { opportunity_id: "p1", category_code: "grant", is_primary: true },
      { opportunity_id: "p1", category_code: "exchange", is_primary: false },
    ];
    expect(mapCategories("grant", links)).toEqual(["grant", "exchange", "research"]);
    expect(mapCategories("grant", [])).toEqual(["grant"]);
  });
});
