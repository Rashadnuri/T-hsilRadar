import type { EducationLevel, FieldOfStudy, OpportunityType } from "./opportunity";

/**
 * A user's PRIVATE profile (DATA_MODEL.md §15, `public.profiles`). Owned by exactly one user;
 * never shown to anyone else and never part of any public query. Email and password live in
 * Supabase Auth, not here.
 */

/** CEFR levels plus "native". */
export const LANGUAGE_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "native"] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];

export interface ProfileLanguage {
  /** ISO 639-1 code, e.g. "en". */
  code: string;
  level: LanguageLevel;
}

export interface ProfileInput {
  fullName: string | null;
  educationLevel: EducationLevel | null;
  university: string | null;
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

export interface Profile extends ProfileInput {
  /** The Supabase Auth user id (same as auth.users.id). */
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** Single source of the limits; mirrored by the database CHECK constraints (migration 8). */
export const PROFILE_LIMITS = {
  fullNameMin: 2,
  fullNameMax: 120,
  universityMax: 200,
  skillsMax: 30,
  skillMax: 50,
  interestsMax: 20,
  interestMax: 60,
  countriesMax: 20,
  languagesMax: 20,
  /** Graduation year window, relative to the current year. */
  graduationYearPast: 60,
  graduationYearFuture: 10,
} as const;

export const EMPTY_PROFILE_INPUT: ProfileInput = {
  fullName: null,
  educationLevel: null,
  university: null,
  academicField: null,
  graduationYear: null,
  countryOfResidence: null,
  preferredCountries: [],
  skills: [],
  languages: [],
  careerInterests: [],
  preferredOpportunityTypes: [],
};
