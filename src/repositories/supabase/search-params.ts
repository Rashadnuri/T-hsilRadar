import { defaultSort } from "@/lib/opportunities/search";
import { resolveSearchTokens } from "@/lib/opportunities/search-tokens";
import type { OpportunityFilters } from "@/validation/opportunity-filters";

/** Extra constraints the app adds on top of the visitor's filters. */
export interface SearchExtras {
  /** Only featured records (homepage). */
  featured?: boolean;
  /** Scope must match exactly: records open to both markets are excluded (homepage groups). */
  scopeExact?: boolean;
  /** Hide demo records (SHOW_DEMO_CONTENT=false). */
  excludeDemo?: boolean;
}

/** Visitor filters → the jsonb argument of search_opportunities / catalogue_facets. */
export function buildSearchFilters(filters: OpportunityFilters, extras: SearchExtras = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["type", "scope", "country", "city", "level", "field", "funding", "location", "deadline", "verification"] as const) {
    const value = filters[key];
    if (value) out[key] = value;
  }
  out.sort = filters.sort ?? defaultSort(filters.q);
  const tokens = resolveSearchTokens(filters.q);
  if (tokens.length) out.tokens = tokens;
  if (extras.featured) out.featured = true;
  if (extras.scopeExact) out.scope_exact = true;
  if (extras.excludeDemo) out.exclude_demo = true;
  return out;
}
