import { CITIES, getCity } from "@/lib/opportunities/cities";
import { isValidTimeZone, zonedLocalToUtc } from "@/lib/opportunities/deadline";
import { isValidSlug, slugify } from "@/lib/opportunities/slug";
import { isIsoCountryCode, PROFILE_LANGUAGE_CODES } from "@/lib/countries";
import {
  DEADLINE_TYPES, EDUCATION_LEVELS, FIELDS_OF_STUDY, FUNDING_PERIODS, FUNDING_TYPES, LOCATION_TYPES, OPPORTUNITY_TYPES, ORGANIZATION_KINDS,
  type EducationLevel, type FieldOfStudy,
} from "@/types/opportunity";
import { EDITABLE_TRANSLATION_STATUSES, TRANSLATION_LANGUAGES, type OpportunityFormInput, type OrganizationFormInput, type TranslationInput } from "@/types/admin";
import type { SourceFormInput } from "@/types/source";
import { hasRawHtml, type FieldError, type FieldErrors, type ValidationCode } from "./messages";

/**
 * Admin form parsing. Like every validator here it produces CODES (never prose); the UI localizes
 * them. These rules mirror the database constraints, so a mistake is caught with a friendly,
 * translated message before the database would refuse it (the database stays the final judge).
 */

/** Database uuids (or "demo-…" ids in the development data). */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const LIMITS = { title: 200, short: 400, long: 20_000, mid: 10_000, name: 200, label: 80, city: 100 } as const;

class Collector {
  readonly errors: FieldErrors = {};
  add(field: string, code: ValidationCode, params?: Record<string, number>) {
    if (!(field in this.errors)) this.errors[field] = params ? ({ code, params } as FieldError) : { code };
  }
  get ok() {
    return Object.keys(this.errors).length === 0;
  }
}

const text = (form: FormData, name: string) => (typeof form.get(name) === "string" ? (form.get(name) as string) : "");
const trimmed = (form: FormData, name: string) => text(form, name).trim();
const blankToNull = (v: string) => (v === "" ? null : v);
const many = (form: FormData, name: string) => form.getAll(name).filter((v): v is string => typeof v === "string" && v.trim() !== "");
const oneOf = <T extends string>(value: string, allowed: readonly T[]): value is T => (allowed as readonly string[]).includes(value);

function optionalText(c: Collector, field: string, value: string, max: number): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length > max) c.add(field, "text_too_long", { max });
  else if (hasRawHtml(v)) c.add(field, "html_not_allowed");
  return v;
}

function httpsUrl(c: Collector, field: string, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    const url = new URL(v);
    if (url.protocol !== "https:" || !url.hostname.includes(".") || /\s/.test(v) || url.username || url.password || v.length > 2000) throw new Error("bad");
  } catch {
    c.add(field, "invalid_url");
  }
  return v;
}

function amount(c: Collector, field: string, value: string): number | null {
  const v = value.trim().replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1e12) c.add(field, "invalid_amount");
  return n;
}

function currency(c: Collector, field: string, value: string): string | null {
  const v = value.trim().toUpperCase();
  if (!v) return null;
  if (!/^[A-Z]{3}$/.test(v)) c.add(field, "invalid_currency");
  return v;
}

export type ParsedOpportunity = { ok: true; value: OpportunityFormInput } | { ok: false; errors: FieldErrors };

/**
 * Reads the opportunity form. `existingLanguages` are the non-original translations that already
 * exist, so a section the admin emptied can be turned into a removal.
 */
export function parseOpportunityForm(form: FormData, options: { existingLanguages?: readonly string[]; existingOriginalLanguage?: string } = {}): ParsedOpportunity {
  const c = new Collector();
  const id = trimmed(form, "id");

  const originalLanguage = options.existingOriginalLanguage ?? trimmed(form, "originalLanguage");
  if (!oneOf(originalLanguage, PROFILE_LANGUAGE_CODES)) c.add("originalLanguage", "invalid_language");

  // translations: one section per supported language, plus the original language when it is another one
  const languages = [...new Set<string>([...TRANSLATION_LANGUAGES, originalLanguage])].filter((l) => /^[a-z]{2}$/.test(l));
  const translations: TranslationInput[] = [];
  const removeLanguages: string[] = [];
  for (const language of languages) {
    const key = (f: string) => `t_${language}_${f}`;
    const title = trimmed(form, key("title"));
    const fields = {
      shortDescription: optionalText(c, key("short"), text(form, key("short")), LIMITS.short),
      description: optionalText(c, key("description"), text(form, key("description")), LIMITS.long),
      requirements: optionalText(c, key("requirements"), text(form, key("requirements")), LIMITS.mid),
      benefits: optionalText(c, key("benefits"), text(form, key("benefits")), LIMITS.mid),
      eligibility: optionalText(c, key("eligibility"), text(form, key("eligibility")), LIMITS.mid),
    };
    const isOriginal = language === originalLanguage;
    const anyText = Object.values(fields).some((v) => v !== null);
    if (!title) {
      if (isOriginal) c.add(key("title"), "required");
      else if (anyText) c.add(key("title"), "required"); // a partial translation still needs a title
      else if (options.existingLanguages?.includes(language)) removeLanguages.push(language);
      continue;
    }
    if (title.length > LIMITS.title) c.add(key("title"), "text_too_long", { max: LIMITS.title });
    else if (hasRawHtml(title)) c.add(key("title"), "html_not_allowed");
    let status: TranslationInput["status"] = "original";
    if (!isOriginal) {
      const requested = trimmed(form, key("status")) || "human";
      if (oneOf(requested, EDITABLE_TRANSLATION_STATUSES)) status = requested;
      else c.add(key("status"), "invalid_choice");
      if (status === "original") status = "human";
    }
    translations.push({ language, title, ...fields, status });
  }

  const organizationId = trimmed(form, "organizationId");
  if (!organizationId) c.add("organizationId", "required");
  else if (!ID_PATTERN.test(organizationId)) c.add("organizationId", "invalid_choice");

  const opportunityType = trimmed(form, "opportunityType");
  if (!oneOf(opportunityType, OPPORTUNITY_TYPES)) c.add("opportunityType", opportunityType ? "invalid_choice" : "required");
  const otherTypeLabel = optionalText(c, "otherTypeLabel", text(form, "otherTypeLabel"), LIMITS.label);
  if (opportunityType === "other" && !otherTypeLabel) c.add("otherTypeLabel", "other_label_required");
  if (opportunityType !== "other" && otherTypeLabel) c.add("otherTypeLabel", "other_label_not_allowed");

  const locationType = trimmed(form, "locationType");
  if (!oneOf(locationType, LOCATION_TYPES)) c.add("locationType", locationType ? "invalid_choice" : "required");
  const country = blankToNull(trimmed(form, "country").toUpperCase());
  if (country && !isIsoCountryCode(country)) c.add("country", "invalid_country");
  if (!country && locationType !== "remote" && !c.errors.locationType) c.add("country", "required");

  const cityIdRaw = blankToNull(trimmed(form, "cityId"));
  const cityText = optionalText(c, "cityText", text(form, "cityText"), LIMITS.city);
  if (cityIdRaw && cityText) c.add("cityText", "city_conflict");
  if (cityIdRaw) {
    const city = getCity(cityIdRaw);
    if (!city) c.add("cityId", "invalid_choice");
    else if (country && city.country !== country) c.add("cityId", "city_conflict");
  }

  const educationLevels = many(form, "educationLevels");
  if (!educationLevels.every((v) => oneOf(v, EDUCATION_LEVELS))) c.add("educationLevels", "invalid_choice");
  const eligibleFields = many(form, "eligibleFields");
  if (!eligibleFields.every((v) => oneOf(v, FIELDS_OF_STUDY))) c.add("eligibleFields", "invalid_choice");

  const countriesRaw = trimmed(form, "eligibleCountries");
  let eligibleCountries: string[] | null = null;
  if (countriesRaw) {
    eligibleCountries = [...new Set(countriesRaw.split(/[\s,;]+/).map((v) => v.toUpperCase()).filter(Boolean))];
    if (eligibleCountries.length === 0 || !eligibleCountries.every(isIsoCountryCode)) c.add("eligibleCountries", "invalid_country");
  }

  const fundingType = trimmed(form, "fundingType") || "not_specified";
  if (!oneOf(fundingType, FUNDING_TYPES)) c.add("fundingType", "invalid_choice");
  const fundingAmount = amount(c, "fundingAmount", text(form, "fundingAmount"));
  const fundingCurrency = currency(c, "fundingCurrency", text(form, "fundingCurrency"));
  const fundingPeriodRaw = trimmed(form, "fundingPeriod");
  const fundingPeriod = fundingPeriodRaw ? (oneOf(fundingPeriodRaw, FUNDING_PERIODS) ? fundingPeriodRaw : (c.add("fundingPeriod", "invalid_choice"), null)) : null;
  const percentRaw = trimmed(form, "fundingPercent");
  const fundingPercent = percentRaw ? Number(percentRaw) : null;
  if (fundingPercent !== null && (!Number.isInteger(fundingPercent) || fundingPercent < 1 || fundingPercent > 100)) c.add("fundingPercent", "invalid_amount");
  if ((fundingAmount === null) !== (fundingCurrency === null)) c.add(fundingAmount === null ? "fundingAmount" : "fundingCurrency", "funding_pair");
  if (fundingAmount !== null && !["fully_funded", "partially_funded", "paid", "tuition_discount"].includes(fundingType)) c.add("fundingAmount", "funding_not_allowed");
  if (fundingPeriod !== null && fundingAmount === null) c.add("fundingPeriod", "funding_pair");
  if (fundingPercent !== null && fundingType !== "tuition_discount") c.add("fundingPercent", "percent_not_allowed");
  const feeAmount = amount(c, "feeAmount", text(form, "feeAmount"));
  const feeCurrency = currency(c, "feeCurrency", text(form, "feeCurrency"));
  if ((feeAmount === null) !== (feeCurrency === null)) c.add(feeAmount === null ? "feeAmount" : "feeCurrency", "funding_pair");

  const applicationUrl = httpsUrl(c, "applicationUrl", text(form, "applicationUrl"));
  const officialSourceUrl = httpsUrl(c, "officialSourceUrl", text(form, "officialSourceUrl"));

  const deadlineTimezone = trimmed(form, "deadlineTimezone") || "Asia/Baku";
  if (!isValidTimeZone(deadlineTimezone)) c.add("deadlineTimezone", "invalid_timezone");
  const deadlineType = trimmed(form, "deadlineType") || "unknown";
  if (!oneOf(deadlineType, DEADLINE_TYPES)) c.add("deadlineType", "invalid_choice");
  const when = (field: string): string | null => {
    const raw = trimmed(form, field);
    if (!raw) return null;
    const utc = zonedLocalToUtc(raw, isValidTimeZone(deadlineTimezone) ? deadlineTimezone : "Asia/Baku");
    if (!utc) c.add(field, "invalid_date");
    return utc;
  };
  const applicationStartDate = when("startDate");
  const applicationDeadline = when("deadline");
  if (deadlineType === "fixed" && !applicationDeadline && !c.errors.deadline) c.add("deadline", "deadline_required");
  if (deadlineType !== "fixed" && applicationDeadline) c.add("deadline", "deadline_not_allowed");
  if (applicationStartDate && applicationDeadline && applicationStartDate > applicationDeadline) c.add("startDate", "dates_out_of_order");

  const slugInput = trimmed(form, "slug").toLowerCase();
  const original = translations.find((t) => t.status === "original");
  const slug = slugInput || slugify(original?.title ?? "");
  if (!isValidSlug(slug)) c.add("slug", slugInput ? "invalid_slug" : "required");

  if (!c.ok) return { ok: false, errors: c.errors };
  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      slug,
      organizationId,
      opportunityType: opportunityType as OpportunityFormInput["opportunityType"],
      otherTypeLabel,
      locationType: locationType as OpportunityFormInput["locationType"],
      country,
      cityId: cityIdRaw,
      cityText,
      educationLevels: educationLevels as EducationLevel[],
      eligibleFields: eligibleFields as FieldOfStudy[],
      eligibleCountries,
      fundingType: fundingType as OpportunityFormInput["fundingType"],
      fundingAmount,
      fundingCurrency,
      fundingPeriod,
      fundingPercent,
      participationFeeAmount: feeAmount,
      participationFeeCurrency: feeCurrency,
      applicationUrl,
      officialSourceUrl,
      applicationStartDate,
      applicationDeadline,
      deadlineType: deadlineType as OpportunityFormInput["deadlineType"],
      deadlineTimezone,
      originalLanguage,
      featured: form.get("featured") === "on" || form.get("featured") === "true",
      translations,
      removeLanguages,
    },
  };
}

export type ParsedOrganization = { ok: true; value: OrganizationFormInput } | { ok: false; errors: FieldErrors };

export function parseOrganizationForm(form: FormData): ParsedOrganization {
  const c = new Collector();
  const name = trimmed(form, "name");
  if (!name) c.add("name", "required");
  else if (name.length > LIMITS.name) c.add("name", "text_too_long", { max: LIMITS.name });
  else if (hasRawHtml(name)) c.add("name", "html_not_allowed");
  const kind = trimmed(form, "kind");
  if (!oneOf(kind, ORGANIZATION_KINDS)) c.add("kind", kind ? "invalid_choice" : "required");
  const country = blankToNull(trimmed(form, "country").toUpperCase());
  if (country && !isIsoCountryCode(country)) c.add("country", "invalid_country");
  const websiteUrl = httpsUrl(c, "websiteUrl", text(form, "websiteUrl"));
  const slugInput = trimmed(form, "slug").toLowerCase();
  const slug = slugInput || slugify(name);
  if (!isValidSlug(slug)) c.add("slug", slugInput ? "invalid_slug" : "required");
  const id = trimmed(form, "id");
  if (id && !ID_PATTERN.test(id)) c.add("slug", "invalid_choice");
  if (!c.ok) return { ok: false, errors: c.errors };
  return { ok: true, value: { ...(id ? { id } : {}), slug, kind: kind as OrganizationFormInput["kind"], name, country, websiteUrl } };
}

/** Exposed for the form: the cities an admin can pick. */
export const CITY_CHOICES = CITIES;

export type ParsedSource = { ok: true; value: SourceFormInput } | { ok: false; errors: FieldErrors };

/** The source form: the official website of an organization and HOW its data is obtained. */
export function parseSourceForm(form: FormData): ParsedSource {
  const c = new Collector();
  const organizationName = trimmed(form, "organizationName");
  if (!organizationName) c.add("organizationName", "required");
  else if (organizationName.length > LIMITS.name) c.add("organizationName", "text_too_long", { max: LIMITS.name });
  else if (hasRawHtml(organizationName)) c.add("organizationName", "html_not_allowed");
  const websiteUrl = httpsUrl(c, "websiteUrl", text(form, "websiteUrl"));
  if (!websiteUrl) c.add("websiteUrl", "required");
  const kind = trimmed(form, "sourceType");
  if (!oneOf(kind, ORGANIZATION_KINDS)) c.add("sourceType", kind ? "invalid_choice" : "required");
  const country = blankToNull(trimmed(form, "country").toUpperCase());
  if (country && !isIsoCountryCode(country)) c.add("country", "invalid_country");
  const accessMethod = trimmed(form, "accessMethod") || "official_website";
  if (!oneOf(accessMethod, ["official_api", "authorized_feed", "official_website", "manual"] as const)) c.add("accessMethod", "invalid_choice");
  const notes = optionalText(c, "notes", text(form, "notes"), 2000);
  const organizationId = blankToNull(trimmed(form, "organizationId"));
  if (organizationId && !ID_PATTERN.test(organizationId)) c.add("organizationId", "invalid_choice");
  const id = trimmed(form, "id");
  if (id && !ID_PATTERN.test(id)) c.add("organizationName", "invalid_choice");
  if (!c.ok) return { ok: false, errors: c.errors };
  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      organizationName, websiteUrl: websiteUrl!, sourceType: kind as SourceFormInput["sourceType"], country,
      accessMethod: accessMethod as SourceFormInput["accessMethod"], isActive: form.get("isActive") === "on" || form.get("isActive") === "true", notes, organizationId,
    },
  };
}
