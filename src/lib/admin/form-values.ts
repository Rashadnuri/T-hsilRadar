import { getCity } from "@/lib/opportunities/cities";
import { utcToZonedLocal } from "@/lib/opportunities/deadline";
import type { OpportunityRecord } from "@/types/opportunity";

/** Plain strings for the form inputs (all serializable: the form is a client component). */
export type FormValues = Record<string, string | string[]>;

export const EMPTY_FORM_VALUES: FormValues = {
  slug: "", organizationId: "", opportunityType: "scholarship", otherTypeLabel: "", locationType: "onsite", country: "", cityId: "", cityText: "",
  educationLevels: [], eligibleFields: [], eligibleCountries: "", fundingType: "not_specified", fundingAmount: "", fundingCurrency: "", fundingPeriod: "", fundingPercent: "",
  feeAmount: "", feeCurrency: "", startDate: "", deadlineType: "rolling", deadline: "", deadlineTimezone: "Asia/Baku", officialSourceUrl: "", applicationUrl: "", originalLanguage: "az",
  featured: "",
};

export function recordToFormValues(o: OpportunityRecord): FormValues {
  const zone = o.deadlineTimezone;
  const values: FormValues = {
    slug: o.slug, organizationId: o.organizationId, opportunityType: o.opportunityType, otherTypeLabel: o.otherTypeLabel ?? "", locationType: o.locationType,
    country: o.country ?? "", cityId: o.cityId && getCity(o.cityId) ? o.cityId : "", cityText: o.cityText ?? "", educationLevels: [...o.educationLevels], eligibleFields: [...o.eligibleFields],
    eligibleCountries: (o.eligibleCountries ?? []).join(", "), fundingType: o.fundingType, fundingAmount: o.fundingAmount?.toString() ?? "", fundingCurrency: o.fundingCurrency ?? "",
    fundingPeriod: o.fundingPeriod ?? "", fundingPercent: o.fundingPercent?.toString() ?? "", feeAmount: o.participationFeeAmount?.toString() ?? "", feeCurrency: o.participationFeeCurrency ?? "",
    startDate: o.applicationStartDate ? utcToZonedLocal(o.applicationStartDate, zone) : "", deadlineType: o.deadlineType, deadline: o.applicationDeadline ? utcToZonedLocal(o.applicationDeadline, zone) : "",
    deadlineTimezone: zone, officialSourceUrl: o.officialSourceUrl ?? "", applicationUrl: o.applicationUrl ?? "", originalLanguage: o.originalLanguage, featured: o.featured ? "on" : "",
  };
  for (const t of o.translations) {
    values[`t_${t.language}_title`] = t.title;
    values[`t_${t.language}_short`] = t.shortDescription ?? "";
    values[`t_${t.language}_description`] = t.description ?? "";
    values[`t_${t.language}_requirements`] = t.requirements ?? "";
    values[`t_${t.language}_benefits`] = t.benefits ?? "";
    values[`t_${t.language}_eligibility`] = t.eligibility ?? "";
    values[`t_${t.language}_status`] = t.status === "machine_draft" ? "machine_draft" : "human";
  }
  return values;
}

/** The state of each translation slot, for badges: what an admin needs to see at a glance. */
export type TranslationSlotState = "original" | "human" | "machine_draft" | "machine_approved" | "outdated" | "missing";

export function translationSlots(o: Pick<OpportunityRecord, "translations" | "originalLanguage">, languages: readonly string[]): { language: string; state: TranslationSlotState }[] {
  return languages.map((language) => ({ language, state: o.translations.find((t) => t.language === language)?.status ?? "missing" }));
}
