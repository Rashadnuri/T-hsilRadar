import type { Facets } from "@/lib/opportunities/search";
import type { OpportunityRecord, Organization, Paginated } from "@/types/opportunity";
import type { OpportunityFilters } from "@/validation/opportunity-filters";

/**
 * Data-access contracts. Features and pages never touch Supabase (or the demo data) directly:
 * they call the services, which call a repository chosen from the environment.
 *
 * Every method returns only what the PUBLIC may see (published, verified-or-demo opportunities,
 * their organizations, their non-draft translations). Writes do not exist here: public users
 * cannot create, change or delete anything, and admin writes arrive with the admin phase.
 */

export interface SearchOptions {
  pageSize?: number;
  /** Injectable clock; tests pin it. */
  now?: Date;
}

export interface FilterOptions {
  countries: string[];
  cities: { id: string; country: string }[];
}

export interface HomepageGroups {
  featured: OpportunityRecord[];
  azerbaijan: OpportunityRecord[];
  international: OpportunityRecord[];
}

export interface OpportunityRepository {
  /** Search + filter + sort + paginate (semantics: lib/opportunities/search.ts). */
  search(filters: OpportunityFilters, options?: SearchOptions): Promise<Paginated<OpportunityRecord>>;
  /** Tab / city counts for the catalogue. */
  facets(filters: OpportunityFilters, now?: Date): Promise<Facets>;
  /** Countries and cities that have public records. */
  filterOptions(): Promise<FilterOptions>;
  /** One public record by slug (expired ones included), or null. */
  getBySlug(slug: string): Promise<OpportunityRecord | null>;
  /** Public records for the given ids, in the order of `ids`; ids that are not public are simply absent. */
  getByIds(ids: readonly string[]): Promise<OpportunityRecord[]>;
  /** Slugs of all public records (static generation). */
  listSlugs(): Promise<string[]>;
  /** Curated, active groups for the homepage. */
  homepageGroups(limit?: number, now?: Date): Promise<HomepageGroups>;
}

export interface OrganizationRepository {
  getBySlug(slug: string): Promise<Organization | null>;
  getById(id: string): Promise<Organization | null>;
  /** Organizations that have at least one public opportunity. */
  listPublic(): Promise<Organization[]>;
}
