import { getOpportunityRepository } from "@/repositories";
import type { OpportunityRecord, Paginated } from "@/types/opportunity";
import type { OpportunityFilters } from "@/validation/opportunity-filters";

/**
 * Data-access boundary for opportunities. Pages and features call ONLY this module; it
 * delegates to the repository chosen by the environment (Supabase, or the labelled demo data
 * when Supabase is not configured). Every function returns public data only.
 */
export { PAGE_SIZE } from "@/repositories/demo/demo-repository";

export async function listOpportunities(
  filters: OpportunityFilters,
  options: { pageSize?: number; now?: Date } = {},
): Promise<Paginated<OpportunityRecord>> {
  return getOpportunityRepository().search(filters, options);
}

/** Counts for the Azerbaijan / International tabs and the Azerbaijani-city shortcuts. */
export async function getCatalogueFacets(filters: OpportunityFilters, now = new Date()) {
  return getOpportunityRepository().facets(filters, now);
}

/** Countries and cities that actually have public records (for the filter selects). */
export async function getFilterOptions() {
  return getOpportunityRepository().filterOptions();
}

/** Public records for a set of ids (the personal plan); non-public ids are absent. */
export async function getOpportunitiesByIds(ids: readonly string[]): Promise<OpportunityRecord[]> {
  return getOpportunityRepository().getByIds(ids);
}

/**
 * Public records for the matching list (up to `limit`, newest first). The search function caps a
 * page at 100, so this reads a few pages; matching itself is a pure function over what it gets.
 */
export async function listOpportunitiesForMatching(limit = 200, now = new Date()): Promise<OpportunityRecord[]> {
  const out: OpportunityRecord[] = [];
  for (let page = 1; out.length < limit; page++) {
    const result = await listOpportunities({ page, sort: "newest" } as OpportunityFilters, { pageSize: 100, now });
    out.push(...result.items);
    if (page >= result.totalPages) break;
  }
  return out.slice(0, limit);
}

/** A public record by slug, expired ones included (their page explains that they ended). */
export async function getOpportunityBySlug(slug: string): Promise<OpportunityRecord | null> {
  return getOpportunityRepository().getBySlug(slug);
}

export async function listAllSlugs(): Promise<string[]> {
  return getOpportunityRepository().listSlugs();
}

/** Curated groups for the homepage (active records only). */
export async function getHomepageGroups(limit = 3, now = new Date()) {
  return getOpportunityRepository().homepageGroups(limit, now);
}
