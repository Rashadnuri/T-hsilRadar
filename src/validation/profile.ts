import { z } from "zod";
import { isIsoCountryCode } from "@/lib/countries";
import { EDUCATION_LEVELS, FIELDS_OF_STUDY, OPPORTUNITY_TYPES } from "@/types/opportunity";
import { LANGUAGE_LEVELS, PROFILE_LIMITS, type ProfileInput } from "@/types/profile";
import { PROFILE_LANGUAGE_CODES } from "@/lib/countries";
import { fields } from "./auth";
import { hasRawHtml, toFieldErrors, type FieldErrors } from "./messages";

const L = PROFILE_LIMITS;

/** Blank form fields mean "not provided". */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blank, schema.optional());

const text = (max: number, tooLong = "text_too_long") =>
  z.string().trim().max(max, tooLong).refine((v) => !hasRawHtml(v), "html_not_allowed");

/** Normalises free-text tags: trim, collapse spaces, drop empties, de-duplicate ignoring case (first spelling wins). */
export function normalizeTags(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.replace(/\s+/g, " ").trim();
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

const tags = (maxItems: number, maxLength: number) =>
  z
    .array(z.string())
    .transform(normalizeTags)
    .pipe(
      z
        .array(z.string().max(maxLength, "item_too_long").refine((v) => !hasRawHtml(v), "html_not_allowed"))
        .max(maxItems, "too_many_items"),
    );

const oneOf = <const T extends readonly [string, ...string[]]>(values: T) => optional(z.enum(values, { error: "invalid_choice" }));

/** The profile schema; `now` is injectable so the graduation-year window is testable. */
export function createProfileSchema(now = new Date()) {
  const year = now.getUTCFullYear();
  const [minYear, maxYear] = [year - L.graduationYearPast, year + L.graduationYearFuture];
  return z.object({
    fullName: z
      .string({ error: "required" })
      .trim()
      .min(1, "required")
      .min(L.fullNameMin, "name_too_short")
      .max(L.fullNameMax, "text_too_long")
      .refine((v) => !hasRawHtml(v), "html_not_allowed"),
    educationLevel: oneOf(EDUCATION_LEVELS),
    university: optional(text(L.universityMax)),
    academicField: oneOf(FIELDS_OF_STUDY),
    graduationYear: optional(
      z.coerce.number({ error: "invalid_year" }).int("invalid_year").min(minYear, "invalid_year").max(maxYear, "invalid_year"),
    ),
    countryOfResidence: optional(z.string().refine(isIsoCountryCode, "invalid_country")),
    preferredCountries: z
      .array(z.string())
      .transform((v) => [...new Set(v.filter((c) => c.trim() !== ""))])
      .pipe(z.array(z.string().refine(isIsoCountryCode, "invalid_country")).max(L.countriesMax, "too_many_items")),
    skills: tags(L.skillsMax, L.skillMax),
    languages: z
      .array(z.object({ code: z.string().refine((c) => (PROFILE_LANGUAGE_CODES as readonly string[]).includes(c), "invalid_language"), level: z.enum(LANGUAGE_LEVELS, { error: "invalid_language" }) }))
      .max(L.languagesMax, "too_many_items")
      .refine((rows) => new Set(rows.map((r) => r.code)).size === rows.length, "duplicate_items"),
    careerInterests: tags(L.interestsMax, L.interestMax),
    preferredOpportunityTypes: z
      .array(z.enum(OPPORTUNITY_TYPES, { error: "invalid_choice" }))
      .max(OPPORTUNITY_TYPES.length, "too_many_items")
      .transform((v) => [...new Set(v)]),
  });
}

export const PROFILE_ERROR_PARAMS = (now = new Date()) => {
  const year = now.getUTCFullYear();
  return {
    name_too_short: { min: L.fullNameMin },
    text_too_long: { max: L.fullNameMax },
    invalid_year: { min: year - L.graduationYearPast, max: year + L.graduationYearFuture },
    too_many_items: { max: L.skillsMax },
    item_too_long: { max: L.skillMax },
  };
};

/** Per-field parameters for messages that depend on which field failed (limits differ per field). */
const FIELD_PARAMS: Record<string, Record<string, number>> = {
  university: { max: L.universityMax },
  fullName: { max: L.fullNameMax, min: L.fullNameMin },
  skills: { max: L.skillsMax },
  careerInterests: { max: L.interestsMax },
  preferredCountries: { max: L.countriesMax },
  languages: { max: L.languagesMax },
};
const ITEM_PARAMS: Record<string, Record<string, number>> = { skills: { max: L.skillMax }, careerInterests: { max: L.interestMax } };

export type ParsedProfile = { ok: true; value: ProfileInput } | { ok: false; errors: FieldErrors };

/** Reads the profile form. Repeated fields (`skills`, `languageCode`…) come in as parallel arrays. */
export function parseProfileForm(form: FormData, now = new Date()): ParsedProfile {
  const strings = (name: string) => form.getAll(name).filter((v): v is string => typeof v === "string");
  const codes = strings("languageCode");
  const levels = strings("languageLevel");
  const languages = codes.flatMap((code, i) => (code === "" && !levels[i] ? [] : [{ code, level: levels[i] ?? "" }]));

  const input = {
    ...fields(form, ["fullName", "educationLevel", "university", "academicField", "graduationYear", "countryOfResidence"]),
    preferredCountries: strings("preferredCountries"),
    skills: strings("skills"),
    languages,
    careerInterests: strings("careerInterests"),
    preferredOpportunityTypes: strings("preferredTypes"),
  };
  const result = createProfileSchema(now).safeParse(input);
  if (!result.success) {
    const errors = toFieldErrors(result.error, {});
    const params = PROFILE_ERROR_PARAMS(now);
    for (const issue of result.error.issues) {
      const field = String(issue.path[0] ?? "form");
      const error = errors[field];
      if (!error || error.params) continue;
      const nested = issue.path.length > 1 && typeof issue.path[1] === "number";
      const base = error.code === "item_too_long" || (nested && field in ITEM_PARAMS) ? ITEM_PARAMS[field] : FIELD_PARAMS[field];
      const fromCode = (params as Record<string, Record<string, number>>)[error.code];
      const merged = { ...fromCode, ...base };
      if (Object.keys(merged).length) error.params = merged;
    }
    return { ok: false, errors };
  }
  const v = result.data;
  return {
    ok: true,
    value: {
      fullName: v.fullName,
      educationLevel: v.educationLevel ?? null,
      university: v.university ?? null,
      academicField: v.academicField ?? null,
      graduationYear: v.graduationYear ?? null,
      countryOfResidence: v.countryOfResidence ?? null,
      preferredCountries: v.preferredCountries,
      skills: v.skills,
      languages: v.languages,
      careerInterests: v.careerInterests,
      preferredOpportunityTypes: v.preferredOpportunityTypes,
    },
  };
}
