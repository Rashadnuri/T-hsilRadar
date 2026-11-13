import { z } from "zod";
import {
  DEADLINE_FILTERS,
  EDUCATION_LEVELS,
  FIELDS_OF_STUDY,
  FUNDING_TYPES,
  LOCATION_TYPES,
  OPPORTUNITY_TYPES,
  SORT_OPTIONS,
  VERIFICATION_STATUSES,
} from "@/types/opportunity";

/** Optional enum: invalid or empty values are dropped instead of throwing. */
const optionalEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).optional().catch(undefined);

/**
 * Validates catalogue query-string input. A hand-edited, stale or legacy URL never breaks the
 * page: anything invalid silently falls back to "no filter". All filters combine with AND.
 */
export const opportunityFiltersSchema = z.object({
  /** Free text: title, organization, keywords (type/field/level/place labels in all languages), description. */
  q: z.string().trim().max(100).optional().catch(undefined),
  /** Dedicated Azerbaijan / International split (see deriveMarketScope). */
  scope: optionalEnum(["azerbaijan", "international"]),
  /** ISO 3166-1 alpha-2 host country; case-insensitive in the URL. */
  country: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((v) => v.toUpperCase()).optional().catch(undefined),
  /** Reference city id (slug), e.g. "baku". */
  city: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60).optional().catch(undefined),
  type: optionalEnum(OPPORTUNITY_TYPES),
  level: optionalEnum(EDUCATION_LEVELS),
  field: optionalEnum(FIELDS_OF_STUDY),
  funding: optionalEnum(FUNDING_TYPES),
  location: optionalEnum(LOCATION_TYPES),
  deadline: optionalEnum(DEADLINE_FILTERS),
  verification: optionalEnum(VERIFICATION_STATUSES),
  sort: optionalEnum(SORT_OPTIONS),
  page: z.coerce.number().int().min(1).max(1000).catch(1).default(1),
});

export type OpportunityFilters = z.infer<typeof opportunityFiltersSchema>;

type RawSearchParams = Record<string, string | string[] | undefined>;

/** Next.js searchParams may contain arrays; take the first value of each key. */
export function parseOpportunityFilters(raw: RawSearchParams): OpportunityFilters {
  const flat = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  // Empty strings (from untouched form fields) mean "no value".
  for (const key of Object.keys(flat)) if (flat[key] === "") delete flat[key];
  return opportunityFiltersSchema.parse(flat);
}

/** Every filter that narrows the list (excludes sort and page). */
export const FILTER_KEYS = [
  "q", "scope", "country", "city", "type", "level", "field", "funding", "location", "deadline", "verification",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** Filters shown in the filter panel (scope has its own tabs; q has the search bar). */
export const PANEL_FILTER_KEYS = ["type", "country", "city", "level", "field", "funding", "location", "deadline", "verification"] as const;
