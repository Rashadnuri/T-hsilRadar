import { csvCell } from "./csv";

/**
 * The CSV format of opportunity imports. One row = one opportunity; the original text and the
 * translations are columns (title_az, short_ru, …), so a row can carry any subset of az/ru/en.
 * Lists use "|" as separator (the file delimiter may be a comma or a semicolon).
 */
export const IMPORT_LANGUAGES = ["az", "ru", "en"] as const;
export const TEXT_FIELDS = ["title", "short", "description", "requirements", "benefits", "eligibility"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

export const BASE_COLUMNS = [
  "slug", "organization", "source", "opportunity_type", "other_type_label", "location_type", "country", "city_id", "city_text",
  "education_levels", "eligible_fields", "eligible_countries", "funding_type", "funding_amount", "funding_currency", "funding_period", "funding_percent",
  "fee_amount", "fee_currency", "application_url", "official_source_url", "start_date", "deadline_type", "deadline", "deadline_timezone",
  "original_language", "translations_reviewed",
] as const;

export const TEXT_COLUMNS: string[] = IMPORT_LANGUAGES.flatMap((l) => TEXT_FIELDS.map((f) => `${f}_${l}`));
export const ALL_COLUMNS: string[] = [...BASE_COLUMNS, ...TEXT_COLUMNS];

/** Columns a file must contain (their VALUES are validated per row). */
export const REQUIRED_COLUMNS = ["organization", "opportunity_type", "location_type", "official_source_url", "deadline_type", "original_language"] as const;

/** CSV column ← form field (the admin form's names), for mapping validation errors back to the file. */
export function fieldToColumn(field: string): string {
  const text = /^t_([a-z]{2})_(title|short|description|requirements|benefits|eligibility|status)$/.exec(field);
  if (text) return text[2] === "status" ? "translations_reviewed" : `${text[2]}_${text[1]}`;
  const map: Record<string, string> = {
    organizationId: "organization", opportunityType: "opportunity_type", otherTypeLabel: "other_type_label", locationType: "location_type", cityId: "city_id", cityText: "city_text",
    educationLevels: "education_levels", eligibleFields: "eligible_fields", eligibleCountries: "eligible_countries", fundingType: "funding_type", fundingAmount: "funding_amount",
    fundingCurrency: "funding_currency", fundingPeriod: "funding_period", fundingPercent: "funding_percent", feeAmount: "fee_amount", feeCurrency: "fee_currency",
    applicationUrl: "application_url", officialSourceUrl: "official_source_url", startDate: "start_date", deadlineType: "deadline_type", deadlineTimezone: "deadline_timezone",
    originalLanguage: "original_language",
  };
  return map[field] ?? field;
}

/** A fictional row that shows the format. The importer REFUSES it (placeholder domain and "EXAMPLE" marker), so it can never reach the catalogue by accident. */
const EXAMPLE: Record<string, string> = {
  slug: "", organization: "exact-organization-slug-or-name", source: "", opportunity_type: "scholarship", location_type: "onsite", country: "DE", city_id: "berlin",
  education_levels: "master|phd", eligible_fields: "ict|engineering", eligible_countries: "AZ|TR", funding_type: "fully_funded", deadline_type: "fixed", deadline: "2030-03-31",
  deadline_timezone: "Europe/Berlin", official_source_url: "https://www.example.com/official-page", original_language: "en", translations_reviewed: "no",
  title_en: "EXAMPLE scholarship (delete this row)", short_en: "One or two sentences copied from the official page.", description_en: "", title_az: "", short_az: "",
};

export function buildTemplateCsv(): string {
  const line = (cells: string[]) => cells.map(csvCell).join(",");
  return `﻿${[line(ALL_COLUMNS), line(ALL_COLUMNS.map((c) => EXAMPLE[c] ?? ""))].join("\r\n")}\r\n`;
}
