import { createHash } from "node:crypto";
import type { OpportunityRecord, Organization } from "@/types/opportunity";
import type { OpportunityTranslation } from "@/types/translation";

/**
 * Turns the in-memory demo records into SQL for `supabase/seed.sql` (loaded by
 * `supabase db reset`) and for the database tests.
 *
 * DEMO DATA ONLY: every row is flagged is_demo = true and unverified. This file must never be
 * used to create real content, and migrations never seed demo data.
 *
 * Dates are emitted RELATIVE to `now()` ("now() + interval '…'"), so a freshly seeded database
 * always has deadlines in the future, however old seed.sql is.
 */

/** Stable UUID derived from a demo key (v5-style), so re-seeding yields the same ids. */
export function demoUuid(key: string): string {
  const hash = createHash("sha1").update(`tahsilradar-demo:${key}`).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const str = (value: string | null | undefined) => (value === null || value === undefined ? "null" : `'${value.replace(/'/g, "''")}'`);
const num = (value: number | null) => (value === null ? "null" : String(value));
const bool = (value: boolean) => (value ? "true" : "false");
const textArray = (values: readonly string[] | null, type: string) =>
  values === null ? "null" : values.length === 0 ? `'{}'::${type}[]` : `array[${values.map(str).join(", ")}]::${type}[]`;

function relativeTimestamp(iso: string | null, nowMs: number): string {
  if (iso === null) return "null";
  const seconds = Math.round((Date.parse(iso) - nowMs) / 1000);
  return `now() + interval '${seconds} seconds'`;
}

function organizationSql(o: Organization): string {
  return `insert into public.organizations (id, slug, kind, name, country, website_url, is_demo) values (${[
    str(demoUuid(o.id)), str(o.slug), str(o.kind), str(o.name), str(o.country), str(o.websiteUrl), bool(o.isDemo),
  ].join(", ")});`;
}

function opportunitySql(r: OpportunityRecord, nowMs: number): string {
  const values = [
    str(demoUuid(r.id)), str(r.slug), str(demoUuid(r.organizationId)), str(r.opportunityType), str(r.otherTypeLabel),
    str(r.locationType), str(r.country), str(r.cityId), str(r.cityText),
    textArray(r.educationLevels, "public.education_level"), textArray(r.eligibleFields, "public.field_of_study"), textArray(r.eligibleCountries, "text"),
    str(r.fundingType), num(r.fundingAmount), str(r.fundingCurrency), str(r.fundingPeriod), num(r.fundingPercent),
    num(r.participationFeeAmount), str(r.participationFeeCurrency),
    str(r.applicationUrl), str(r.officialSourceUrl),
    relativeTimestamp(r.applicationStartDate, nowMs), relativeTimestamp(r.applicationDeadline, nowMs), str(r.deadlineType), str(r.deadlineTimezone),
    str(r.publicationStatus), str(r.verificationStatus), relativeTimestamp(r.lastVerifiedAt, nowMs),
    str(r.originalLanguage), String(r.contentVersion), bool(r.isDemo), bool(r.featured),
    relativeTimestamp(r.publishedAt, nowMs), relativeTimestamp(r.createdAt, nowMs), relativeTimestamp(r.updatedAt, nowMs),
  ];
  return `insert into public.opportunities (id, slug, organization_id, opportunity_type, other_type_label, location_type, country, city_id, city_text, education_levels, eligible_fields, eligible_countries, funding_type, funding_amount, funding_currency, funding_period, funding_percent, participation_fee_amount, participation_fee_currency, application_url, official_source_url, application_start_date, application_deadline, deadline_type, deadline_timezone, publication_status, verification_status, last_verified_at, original_language, content_version, is_demo, featured, published_at, created_at, updated_at) values (${values.join(", ")});`;
}

function translationSql(t: OpportunityTranslation, nowMs: number): string {
  const values = [
    str(demoUuid(t.opportunityId)), str(t.language), str(t.title), str(t.shortDescription), str(t.description), str(t.requirements),
    str(t.benefits), str(t.eligibility), str(t.status), str(t.translatedFrom), String(t.sourceVersion),
    relativeTimestamp(t.createdAt, nowMs), relativeTimestamp(t.updatedAt, nowMs),
  ];
  return `insert into public.opportunity_translations (opportunity_id, language, title, short_description, description, requirements, benefits, eligibility, status, translated_from, source_version, created_at, updated_at) values (${values.join(", ")});`;
}

/** Extra (non-primary) categories; the primary one is created by the database trigger. */
function extraCategoriesSql(r: OpportunityRecord): string[] {
  return r.categories.filter((c) => c !== r.opportunityType).map(
    (c) => `insert into public.opportunity_categories (opportunity_id, category_code, is_primary) values (${str(demoUuid(r.id))}, ${str(c)}, false);`,
  );
}

/** One transaction (the original-language invariant is checked at COMMIT). */
export function generateDemoSeedSql(records: readonly OpportunityRecord[], nowMs: number = Date.now()): string {
  const organizations = [...new Map(records.map((r) => [r.organization.id, r.organization] as const)).values()];
  return [
    "-- DEMO SEED — generated by `npm run db:seed:generate`. DO NOT EDIT BY HAND.",
    "-- Fictional, flagged is_demo, never verified. Never load into a production database.",
    "begin;",
    ...organizations.map(organizationSql),
    ...records.flatMap((r) => [opportunitySql(r, nowMs), ...r.translations.map((t) => translationSql(t, nowMs)), ...extraCategoriesSql(r)]),
    "commit;",
    "",
  ].join("\n");
}
