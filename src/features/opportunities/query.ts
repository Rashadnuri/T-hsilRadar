import type { OpportunityFilters } from "@/validation/opportunity-filters";

/** Builds a clean query object from filters: omits empty values and page 1. */
export function buildQuery(
  filters: Partial<OpportunityFilters>,
  overrides: Partial<Record<keyof OpportunityFilters, string | number | undefined>> = {},
): Record<string, string> {
  const merged: Record<string, string | number | undefined> = { ...filters, ...overrides };
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === "") continue;
    if (key === "page" && Number(value) <= 1) continue;
    query[key] = String(value);
  }
  return query;
}
