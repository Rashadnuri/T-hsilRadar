import type { SupabaseLike } from "@/lib/supabase/types";
import type { EducationLevel, FieldOfStudy, OpportunityType } from "@/types/opportunity";
import type { LanguageLevel, Profile, ProfileInput } from "@/types/profile";
import { ProfileRepositoryError, type ProfileRepository } from "./types";

/** Row shape of public.profiles as PostgREST returns it. */
export interface ProfileRow {
  id: string;
  full_name: string | null;
  education_level: EducationLevel | null;
  university: string | null;
  academic_field: FieldOfStudy | null;
  graduation_year: number | null;
  country_of_residence: string | null;
  preferred_countries: string[];
  skills: string[];
  languages: { code: string; level: LanguageLevel }[];
  career_interests: string[];
  preferred_opportunity_types: OpportunityType[];
  created_at: string;
  updated_at: string;
}

export const PROFILE_COLUMNS = [
  "id", "full_name", "education_level", "university", "academic_field", "graduation_year", "country_of_residence", "preferred_countries",
  "skills", "languages", "career_interests", "preferred_opportunity_types", "created_at", "updated_at",
] as const satisfies readonly (keyof ProfileRow)[];

export const mapProfileRow = (row: ProfileRow): Profile => ({
  id: row.id,
  fullName: row.full_name,
  educationLevel: row.education_level,
  university: row.university,
  academicField: row.academic_field,
  graduationYear: row.graduation_year,
  countryOfResidence: row.country_of_residence,
  preferredCountries: row.preferred_countries ?? [],
  skills: row.skills ?? [],
  languages: row.languages ?? [],
  careerInterests: row.career_interests ?? [],
  preferredOpportunityTypes: row.preferred_opportunity_types ?? [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Writable columns only (id is set from the authenticated user; created_at/updated_at are the database's). */
export const toProfileRow = (userId: string, input: ProfileInput) => ({
  id: userId,
  full_name: input.fullName,
  education_level: input.educationLevel,
  university: input.university,
  academic_field: input.academicField,
  graduation_year: input.graduationYear,
  country_of_residence: input.countryOfResidence,
  preferred_countries: input.preferredCountries,
  skills: input.skills,
  languages: input.languages,
  career_interests: input.careerInterests,
  preferred_opportunity_types: input.preferredOpportunityTypes,
});

/**
 * Reads and writes the signed-in user's profile through Supabase. The client MUST be the one
 * bound to the user's session (never the service-role client): the `authenticated` role plus
 * the RLS policies `id = auth.uid()` are what keep users out of each other's data.
 */
export class SupabaseProfileRepository implements ProfileRepository {
  constructor(private readonly db: SupabaseLike) {}

  async get(userId: string): Promise<Profile | null> {
    const { data, error } = await this.db.from("profiles").select(PROFILE_COLUMNS.join(",")).eq("id", userId).maybeSingle();
    if (error) throw new ProfileRepositoryError("get", error.code);
    return data ? mapProfileRow(data as unknown as ProfileRow) : null;
  }

  async save(userId: string, input: ProfileInput): Promise<Profile> {
    const { error } = await this.db.from("profiles").upsert(toProfileRow(userId, input), { onConflict: "id" });
    if (error) throw new ProfileRepositoryError("save", error.code);
    const saved = await this.get(userId);
    if (!saved) throw new ProfileRepositoryError("save", "not_readable"); // RLS hid the row we just wrote: treat as failure
    return saved;
  }
}
