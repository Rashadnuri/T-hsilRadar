import type { EducationLevel, FieldOfStudy, OpportunityType } from "@/types/opportunity";
import type { ProfileLanguage } from "@/types/profile";

/**
 * The deterministic matching engine's vocabulary. Everything the engine says is a CODE plus
 * plain data (never prose): the UI turns codes into the visitor's language (messages `matching.*`),
 * which keeps the engine testable, auditable, and language-neutral.
 *
 * IMPORTANT: a match score measures how well a profile fits the PUBLISHED criteria of an
 * opportunity. It is not a prediction of admission, selection or success.
 */

/** The part of a user's profile the engine reads. Name, email and university are deliberately absent. */
export interface MatchProfile {
  educationLevel: EducationLevel | null;
  academicField: FieldOfStudy | null;
  graduationYear: number | null;
  /** ISO 3166-1 alpha-2. */
  countryOfResidence: string | null;
  preferredCountries: string[];
  skills: string[];
  languages: ProfileLanguage[];
  careerInterests: string[];
  preferredOpportunityTypes: OpportunityType[];
}

export const CRITERION_IDS = ["open", "education", "field", "country", "type", "location", "interests", "language"] as const;
export type CriterionId = (typeof CRITERION_IDS)[number];

/**
 *  - met:     the profile satisfies it (full credit)
 *  - partial: partly satisfied (fractional credit)
 *  - unmet:   the profile does not satisfy it
 *  - unknown: cannot be decided because the profile (or the opportunity text) lacks the data; earns nothing and is excluded from the score, but lowers `completeness`
 */
export type CriterionStatus = "met" | "partial" | "unmet" | "unknown";

/** Plain data a message needs; every field is a code, a number or a name already in the record. */
export interface CriterionDetail {
  /** What the opportunity accepts / requires (codes: levels, fields, countries, types…). */
  accepted?: string[];
  /** The profile's own value(s) for comparison. */
  yours?: string | number | string[] | null;
  /** Items that matched (terms, languages…). */
  matched?: string[];
  /** Why the result is what it is, when the status alone is not enough. */
  note?: "graduate_rule" | "needs_graduation_year" | "remote" | "upcoming" | "deadline_unknown" | "rolling" | "no_text" | "low_level" | "no_restriction";
  year?: number;
}

export interface Criterion {
  id: CriterionId;
  /** Mandatory criteria decide eligibility; the others only shape the score. */
  mandatory: boolean;
  status: CriterionStatus;
  weight: number;
  /** 0..weight */
  earned: number;
  detail: CriterionDetail;
}

export type Eligibility = "eligible" | "not_eligible" | "unknown";
export type MatchBand = "strong" | "good" | "partial" | "low" | "insufficient" | "ineligible" | "closed";

export interface MatchResult {
  opportunityId: string;
  /** 0..100. Capped at 39 when a mandatory requirement is not met. NOT a probability of admission. */
  score: number;
  band: MatchBand;
  eligibility: Eligibility;
  /** 0..100: share of the applicable criteria (by weight) that could be evaluated with the data available. */
  completeness: number;
  criteria: Criterion[];
  /** Criteria the profile meets (fully or partly). */
  reasons: Criterion[];
  /** Requirements that are not met (mandatory first). */
  missing: Criterion[];
  /** Criteria that could not be evaluated for lack of data. */
  unknown: Criterion[];
  /** True when the opportunity has free-text requirements/eligibility the engine cannot check (GPA, tests, documents…). */
  needsManualReview: boolean;
}

export const SCORE_CAP_WHEN_INELIGIBLE = 39;
