import { daysUntilDeadline, getApplicationState } from "@/lib/opportunities/deadline";
import { resolveContent } from "@/lib/opportunities/translations";
import { getEffectiveVerificationStatus } from "@/lib/opportunities/status";
import type { MatchProfile, MatchResult } from "@/lib/matching/types";
import type { Locale } from "@/i18n/routing";
import type { OpportunityRecord } from "@/types/opportunity";
import { sanitizeUntrusted } from "./sanitize";

/**
 * The ONLY facts the model may use. Built from the public, read-only opportunity record (the
 * same data any visitor sees) plus the deterministic match result and a minimal profile summary.
 * Not included on purpose: names, e-mail, university, user ids, URLs (the UI shows the official
 * links itself, so the model has nothing to invent or to be tricked into repeating).
 */

const TEXT_LIMIT = 2500;
const SHORT_LIMIT = 400;
const TERM_LIMIT = 40;
const TERMS_MAX = 15;

export interface TextFact {
  /** Language the text is actually written in (may differ from the requested one). */
  language: string;
  text: string;
}

export interface OpportunityFacts {
  title: TextFact;
  organization: { name: string; kind: string };
  type: string;
  other_type_label: string | null;
  location: { mode: string; country: string | null; city: string | null };
  education_levels: string[] | "not_stated";
  eligible_fields: string[] | "not_stated";
  eligible_countries: string[] | "not_stated";
  funding: { type: string; amount: number | null; currency: string | null; period: string | null; percent: number | null };
  participation_fee: { amount: number | null; currency: string | null };
  deadline: { type: string; iso: string | null; timezone: string; state: string; days_left: number | null };
  application_start: string | null;
  verification: "verified" | "unverified" | "expired" | "rejected" | "demo";
  official_source_available: boolean;
  application_page_available: boolean;
  short_description: TextFact | null;
  description: TextFact | null;
  requirements: TextFact | null;
  benefits: TextFact | null;
  eligibility: TextFact | null;
  /** Fields the official record does not state. The model must say "not stated" for these, never guess. */
  not_stated: string[];
}

const textFact = (field: { value: string; language: string } | null | undefined, limit: number): TextFact | null =>
  field && field.value.trim() ? { language: field.language, text: sanitizeUntrusted(field.value, limit) } : null;

export function buildOpportunityFacts(o: OpportunityRecord, locale: Locale, now = new Date()): OpportunityFacts {
  const content = resolveContent(o, locale);
  const state = getApplicationState(o, now);
  const verification = o.isDemo ? "demo" : getEffectiveVerificationStatus(o);

  const facts: OpportunityFacts = {
    title: { language: content.title.language, text: sanitizeUntrusted(content.title.value, 300) },
    organization: { name: sanitizeUntrusted(o.organization.name, 200), kind: o.organization.kind },
    type: o.opportunityType,
    other_type_label: o.otherTypeLabel ? sanitizeUntrusted(o.otherTypeLabel, 100) : null,
    location: { mode: o.locationType, country: o.country, city: o.cityText ? sanitizeUntrusted(o.cityText, 100) : o.cityId },
    education_levels: o.educationLevels.length ? [...o.educationLevels] : "not_stated",
    eligible_fields: o.eligibleFields.length ? [...o.eligibleFields] : "not_stated",
    eligible_countries: o.eligibleCountries && o.eligibleCountries.length ? [...o.eligibleCountries] : "not_stated",
    funding: { type: o.fundingType, amount: o.fundingAmount, currency: o.fundingCurrency, period: o.fundingPeriod, percent: o.fundingPercent },
    participation_fee: { amount: o.participationFeeAmount, currency: o.participationFeeCurrency },
    deadline: { type: o.deadlineType, iso: o.applicationDeadline, timezone: o.deadlineTimezone, state, days_left: daysUntilDeadline(o, now) },
    application_start: o.applicationStartDate,
    verification,
    official_source_available: o.officialSourceUrl !== null,
    application_page_available: o.applicationUrl !== null,
    short_description: textFact(content.shortDescription, SHORT_LIMIT),
    description: textFact(content.description, TEXT_LIMIT),
    requirements: textFact(content.requirements, TEXT_LIMIT),
    benefits: textFact(content.benefits, TEXT_LIMIT),
    eligibility: textFact(content.eligibility, TEXT_LIMIT),
    not_stated: [],
  };

  const missing: string[] = [];
  if (facts.deadline.type === "unknown" || (facts.deadline.type === "fixed" && !facts.deadline.iso)) missing.push("deadline");
  if (facts.education_levels === "not_stated") missing.push("education_levels");
  if (facts.eligible_fields === "not_stated") missing.push("eligible_fields");
  if (facts.eligible_countries === "not_stated") missing.push("eligible_countries");
  if (o.fundingType === "not_specified") missing.push("funding");
  else if (o.fundingAmount === null && o.fundingPercent === null && o.fundingType !== "fully_funded" && o.fundingType !== "unpaid") missing.push("funding_amount");
  if (!facts.requirements) missing.push("requirements_text");
  if (!facts.eligibility) missing.push("eligibility_text");
  if (!facts.benefits) missing.push("benefits_text");
  if (!facts.application_page_available) missing.push("application_page");
  if (!facts.official_source_available) missing.push("official_source");
  facts.not_stated = missing;
  return facts;
}

export interface ProfileSummary {
  education_level: string | null;
  academic_field: string | null;
  graduation_year: number | null;
  country_of_residence: string | null;
  preferred_countries: string[];
  skills: string[];
  languages: { code: string; level: string }[];
  career_interests: string[];
  preferred_opportunity_types: string[];
}

const terms = (values: string[]) => values.slice(0, TERMS_MAX).map((v) => sanitizeUntrusted(v, TERM_LIMIT)).filter(Boolean);

/** The profile fields the model needs, nothing else (no name, e-mail, university, id). */
export function summarizeProfile(p: MatchProfile): ProfileSummary {
  return {
    education_level: p.educationLevel,
    academic_field: p.academicField,
    graduation_year: p.graduationYear,
    country_of_residence: p.countryOfResidence,
    preferred_countries: p.preferredCountries.slice(0, 20),
    skills: terms(p.skills),
    languages: p.languages.slice(0, 20).map((l) => ({ code: l.code, level: l.level })),
    career_interests: terms(p.careerInterests),
    preferred_opportunity_types: p.preferredOpportunityTypes.slice(0, 12),
  };
}

export interface MatchSummary {
  score: number;
  eligibility: string;
  band: string;
  data_completeness: number;
  criteria: { id: string; status: string; mandatory: boolean; accepted?: string[]; yours?: unknown; matched?: string[]; note?: string }[];
  free_text_requirements_not_checked: boolean;
}

export function summarizeMatch(m: MatchResult): MatchSummary {
  return {
    score: m.score,
    eligibility: m.eligibility,
    band: m.band,
    data_completeness: m.completeness,
    criteria: m.criteria.map((c) => ({ id: c.id, status: c.status, mandatory: c.mandatory, accepted: c.detail.accepted, yours: c.detail.yours, matched: c.detail.matched, note: c.detail.note })),
    free_text_requirements_not_checked: m.needsManualReview,
  };
}
