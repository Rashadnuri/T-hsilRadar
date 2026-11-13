import { getApplicationState } from "@/lib/opportunities/deadline";
import { getAvailableLanguages, isPublicTranslation } from "@/lib/opportunities/translations";
import type { OpportunityRecord } from "@/types/opportunity";
import type { ProfileInput } from "@/types/profile";
import { foldText } from "@/utils/fold-text";
import {
  SCORE_CAP_WHEN_INELIGIBLE,
  type Criterion,
  type CriterionDetail,
  type CriterionId,
  type CriterionStatus,
  type MatchBand,
  type MatchProfile,
  type MatchResult,
} from "./types";

/**
 * The deterministic, rule-based matching engine. Pure functions: the same profile, record and
 * clock always give the same result, and nothing here calls a network, a database or an LLM, so
 * matching keeps working when every external service is down.
 *
 * Two kinds of criteria:
 *  - MANDATORY (open, education, field, country): the opportunity's published eligibility rules.
 *    Any unmet one makes the profile "not eligible" and caps the score.
 *  - PREFERENCES (type, location, interests, language): how well the opportunity fits what the person
 *    wants. They move the score but never decide eligibility.
 *
 * Score = 100 × Σ earned ÷ Σ weight over the criteria that APPLY and could be EVALUATED.
 * Missing profile data never counts against the person: it is reported as "unknown" and shown in
 * `completeness`.
 */

export const WEIGHTS: Record<CriterionId, number> = {
  open: 10,
  education: 20,
  field: 15,
  country: 15,
  type: 15,
  location: 10,
  interests: 15,
  language: 5,
};
const MANDATORY: readonly CriterionId[] = ["open", "education", "field", "country"];

/** Language levels that count as being able to read an official page. */
const READING_LEVELS = new Set(["B1", "B2", "C1", "C2", "native"]);
const BASIC_LEVELS = new Set(["A1", "A2"]);
const GRADUATE_LEVELS = new Set(["bachelor", "master", "phd", "professional"]);

export const emptyMatchProfile = (): MatchProfile => ({
  educationLevel: null,
  academicField: null,
  graduationYear: null,
  countryOfResidence: null,
  preferredCountries: [],
  skills: [],
  languages: [],
  careerInterests: [],
  preferredOpportunityTypes: [],
});

/** Projects a stored profile onto the fields the engine reads (drops name, university, ids). */
export function toMatchProfile(profile: ProfileInput | null): MatchProfile {
  if (!profile) return emptyMatchProfile();
  return {
    educationLevel: profile.educationLevel,
    academicField: profile.academicField,
    graduationYear: profile.graduationYear,
    countryOfResidence: profile.countryOfResidence,
    preferredCountries: [...profile.preferredCountries],
    skills: [...profile.skills],
    languages: profile.languages.map((l) => ({ ...l })),
    careerInterests: [...profile.careerInterests],
    preferredOpportunityTypes: [...profile.preferredOpportunityTypes],
  };
}

const make = (id: CriterionId, status: CriterionStatus, earnedShare: number, detail: CriterionDetail): Criterion => ({
  id,
  mandatory: MANDATORY.includes(id),
  status,
  weight: WEIGHTS[id],
  earned: Math.round(WEIGHTS[id] * earnedShare * 100) / 100,
  detail,
});

// ── mandatory criteria ──────────────────────────────────────────────────────────────────────

function openCriterion(o: OpportunityRecord, now: Date): Criterion {
  const state = getApplicationState(o, now);
  if (state === "expired") return make("open", "unmet", 0, {});
  if (state === "upcoming") return make("open", "met", 1, { note: "upcoming" });
  if (state === "rolling") return make("open", "met", 1, { note: "rolling" });
  if (state === "deadline_unknown") return make("open", "met", 1, { note: "deadline_unknown" });
  return make("open", "met", 1, {});
}

function educationCriterion(o: OpportunityRecord, p: MatchProfile, now: Date): Criterion | null {
  const accepted = o.educationLevels;
  if (accepted.length === 0) return null; // no restriction stated
  const level = p.educationLevel;
  if (level === null) return make("education", "unknown", 0, { accepted, yours: null });
  if (accepted.includes(level)) return make("education", "met", 1, { accepted, yours: level });

  // "graduate" opportunities accept people who have already completed a degree.
  if (accepted.includes("graduate") && GRADUATE_LEVELS.has(level)) {
    if (p.graduationYear === null) return make("education", "unknown", 0, { accepted, yours: level, note: "needs_graduation_year" });
    const graduated = p.graduationYear <= now.getUTCFullYear();
    return make("education", graduated ? "met" : "unmet", graduated ? 1 : 0, { accepted, yours: level, year: p.graduationYear, note: "graduate_rule" });
  }
  return make("education", "unmet", 0, { accepted, yours: level });
}

function fieldCriterion(o: OpportunityRecord, p: MatchProfile): Criterion | null {
  const accepted = o.eligibleFields;
  if (accepted.length === 0 || accepted.includes("general")) return null; // open to every field
  if (p.academicField === null) return make("field", "unknown", 0, { accepted, yours: null });
  const ok = accepted.includes(p.academicField);
  return make("field", ok ? "met" : "unmet", ok ? 1 : 0, { accepted, yours: p.academicField });
}

/** Eligibility by country. The profile holds the country of RESIDENCE, not citizenship: the explanation says so. */
function countryCriterion(o: OpportunityRecord, p: MatchProfile): Criterion | null {
  const accepted = o.eligibleCountries;
  if (!accepted || accepted.length === 0) return null;
  if (p.countryOfResidence === null) return make("country", "unknown", 0, { accepted, yours: null });
  const ok = accepted.includes(p.countryOfResidence);
  return make("country", ok ? "met" : "unmet", ok ? 1 : 0, { accepted, yours: p.countryOfResidence });
}

// ── preference criteria ─────────────────────────────────────────────────────────────────────

function typeCriterion(o: OpportunityRecord, p: MatchProfile): Criterion {
  if (p.preferredOpportunityTypes.length === 0) return make("type", "unknown", 0, { accepted: [o.opportunityType], yours: [] });
  const ok = p.preferredOpportunityTypes.includes(o.opportunityType);
  return make("type", ok ? "met" : "unmet", ok ? 1 : 0, { accepted: [o.opportunityType], yours: p.preferredOpportunityTypes });
}

function locationCriterion(o: OpportunityRecord, p: MatchProfile): Criterion {
  const where = o.country ? [o.country] : [];
  if (p.preferredCountries.length === 0) return make("location", "unknown", 0, { accepted: where, yours: [] });
  if (o.locationType === "remote") return make("location", "partial", 0.7, { accepted: where, yours: p.preferredCountries, note: "remote" });
  if (o.country === null) return make("location", "unknown", 0, { accepted: [], yours: p.preferredCountries });
  const ok = p.preferredCountries.includes(o.country);
  return make("location", ok ? "met" : "unmet", ok ? 1 : 0, { accepted: where, yours: p.preferredCountries });
}

/** All PUBLIC text of the record in every language, folded for comparison. */
function publicText(o: OpportunityRecord): string {
  const parts: string[] = [];
  for (const t of o.translations) {
    if (!isPublicTranslation(t)) continue;
    parts.push(t.title, t.shortDescription ?? "", t.description ?? "", t.requirements ?? "", t.benefits ?? "", t.eligibility ?? "");
  }
  if (o.otherTypeLabel) parts.push(o.otherTypeLabel);
  return foldText(parts.join(" \n "));
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A term is present when it starts a word ("program" ≈ "programming"); terms of ≤ 3 characters must be whole words ("AI", "C#"). */
export function termMatches(foldedText: string, term: string): boolean {
  const t = foldText(term).trim();
  if (t.length < 2) return false;
  const edge = "[^\\p{L}\\p{N}]";
  const tail = t.length <= 3 ? `(?:${edge}|$)` : "";
  return new RegExp(`(?:^|${edge})${escapeRegExp(t)}${tail}`, "u").test(foldedText);
}

function interestsCriterion(o: OpportunityRecord, p: MatchProfile): Criterion {
  const terms = [...new Set([...p.skills, ...p.careerInterests].map((t) => t.trim()).filter(Boolean))];
  if (terms.length === 0) return make("interests", "unknown", 0, { yours: [] });
  const text = publicText(o);
  if (text.length < 40) return make("interests", "unknown", 0, { yours: terms, note: "no_text" });
  const matched = terms.filter((term) => termMatches(text, term));
  if (matched.length === 0) return make("interests", "unmet", 0, { yours: terms, matched: [] });
  // Full credit once two of the person's terms appear (or the only one they have); a single hit among several is partial.
  const share = Math.min(1, matched.length / Math.min(terms.length, 2));
  return make("interests", share >= 1 ? "met" : "partial", share, { yours: terms, matched });
}

function languageCriterion(o: OpportunityRecord, p: MatchProfile): Criterion {
  const published = getAvailableLanguages(o);
  if (p.languages.length === 0) return make("language", "unknown", 0, { accepted: published, yours: [] });
  const known = p.languages.filter((l) => published.includes(l.code));
  const reading = known.filter((l) => READING_LEVELS.has(l.level));
  if (reading.length > 0) return make("language", "met", 1, { accepted: published, yours: p.languages.map((l) => l.code), matched: reading.map((l) => l.code) });
  const basic = known.filter((l) => BASIC_LEVELS.has(l.level));
  if (basic.length > 0) return make("language", "partial", 0.4, { accepted: published, yours: p.languages.map((l) => l.code), matched: basic.map((l) => l.code), note: "low_level" });
  return make("language", "unmet", 0, { accepted: published, yours: p.languages.map((l) => l.code), matched: [] });
}

// ── assembly ────────────────────────────────────────────────────────────────────────────────

function bandFor(score: number): MatchBand {
  if (score >= 75) return "strong";
  if (score >= 55) return "good";
  if (score >= 40) return "partial";
  return "low";
}

/** Free-text conditions the engine cannot evaluate (grades, exams, documents). */
const hasFreeTextRequirements = (o: OpportunityRecord) => o.translations.some((t) => isPublicTranslation(t) && ((t.requirements ?? "").trim() !== "" || (t.eligibility ?? "").trim() !== ""));

export function matchOpportunity(profile: MatchProfile, o: OpportunityRecord, now = new Date()): MatchResult {
  const criteria = [
    openCriterion(o, now),
    educationCriterion(o, profile, now),
    fieldCriterion(o, profile),
    countryCriterion(o, profile),
    typeCriterion(o, profile),
    locationCriterion(o, profile),
    interestsCriterion(o, profile),
    languageCriterion(o, profile),
  ].filter((c): c is Criterion => c !== null);

  const applicableWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  const evaluated = criteria.filter((c) => c.status !== "unknown");
  const evaluatedWeight = evaluated.reduce((sum, c) => sum + c.weight, 0);
  const earned = evaluated.reduce((sum, c) => sum + c.earned, 0);

  const mandatoryUnmet = criteria.some((c) => c.mandatory && c.status === "unmet");
  const mandatoryUnknown = criteria.some((c) => c.mandatory && c.status === "unknown");
  const closed = criteria.some((c) => c.id === "open" && c.status === "unmet");

  const raw = evaluatedWeight === 0 ? 0 : Math.round((100 * earned) / evaluatedWeight);
  const score = Math.max(0, Math.min(100, mandatoryUnmet ? Math.min(raw, SCORE_CAP_WHEN_INELIGIBLE) : raw));
  const completeness = applicableWeight === 0 ? 100 : Math.round((100 * evaluatedWeight) / applicableWeight);
  const eligibility = mandatoryUnmet ? "not_eligible" : mandatoryUnknown ? "unknown" : "eligible";

  const band: MatchBand = closed ? "closed" : mandatoryUnmet ? "ineligible" : completeness < 50 ? "insufficient" : bandFor(score);

  const byImportance = (a: Criterion, b: Criterion) => Number(b.mandatory) - Number(a.mandatory) || b.weight - a.weight;
  return {
    opportunityId: o.id,
    score,
    band,
    eligibility,
    completeness,
    criteria,
    reasons: criteria.filter((c) => c.status === "met" || c.status === "partial").sort(byImportance),
    missing: criteria.filter((c) => c.status === "unmet").sort(byImportance),
    unknown: criteria.filter((c) => c.status === "unknown").sort(byImportance),
    needsManualReview: hasFreeTextRequirements(o),
  };
}

/** Best matches first: eligible/unknown before ineligible before closed; then by score; ties by earlier deadline are left to the caller's order. */
const RANK: Record<MatchBand, number> = { strong: 0, good: 0, partial: 0, low: 0, insufficient: 0, ineligible: 1, closed: 2 };

export function rankMatches(profile: MatchProfile, records: readonly OpportunityRecord[], now = new Date()): { record: OpportunityRecord; match: MatchResult }[] {
  return records
    .map((record, index) => ({ record, match: matchOpportunity(profile, record, now), index }))
    .sort((a, b) => RANK[a.match.band] - RANK[b.match.band] || b.match.score - a.match.score || a.index - b.index)
    .map(({ record, match }) => ({ record, match }));
}
