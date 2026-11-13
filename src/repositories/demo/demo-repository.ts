import { getDemoRecords } from "@/features/opportunities/demo-data";
import { compareByDeadline } from "@/lib/opportunities/deadline";
import { deriveMarketScope } from "@/lib/opportunities/location";
import { computeFacets, defaultSort, getFilterOptions as computeFilterOptions, matchesFilters, sortRecords } from "@/lib/opportunities/search";
import { isListable, isPublic } from "@/lib/opportunities/status";
import { isPublicTranslation } from "@/lib/opportunities/translations";
import type { OpportunityRecord, Organization } from "@/types/opportunity";
import type { OrganizationRepository, OpportunityRepository, SearchOptions } from "../types";

export const PAGE_SIZE = 6;

/**
 * Serves the labelled, fictional demo records from memory. Used when Supabase is not
 * configured (local UI work, previews, CI) — and as the reference implementation of the
 * semantics the SQL functions must reproduce (see supabase/tests/search-parity.test.ts).
 */
export class DemoOpportunityRepository implements OpportunityRepository {
  constructor(private readonly options: { enabled: boolean } = { enabled: true }) {}

  /** Public view of the demo data: published records only, and never unreviewed machine drafts (as RLS does in the database). */
  private loadPublic(): OpportunityRecord[] {
    if (!this.options.enabled) return [];
    return getDemoRecords()
      .filter(isPublic)
      .map((r) => ({ ...r, translations: r.translations.filter(isPublicTranslation) }));
  }

  async search(filters: Parameters<OpportunityRepository["search"]>[0], { pageSize = PAGE_SIZE, now = new Date() }: SearchOptions = {}) {
    const matched = this.loadPublic().filter((o) => matchesFilters(o, filters, now));
    const items = sortRecords(matched, filters.sort ?? defaultSort(filters.q), filters.q, now);
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(filters.page, totalPages);
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, totalPages };
  }

  async facets(filters: Parameters<OpportunityRepository["facets"]>[0], now = new Date()) {
    return computeFacets(this.loadPublic(), filters, now);
  }

  async filterOptions() {
    return computeFilterOptions(this.loadPublic());
  }

  async getBySlug(slug: string) {
    return this.loadPublic().find((o) => o.slug === slug) ?? null;
  }

  async getByIds(ids: readonly string[]) {
    const byId = new Map(this.loadPublic().map((o) => [o.id, o] as const));
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }

  async listSlugs() {
    return this.loadPublic().map((o) => o.slug);
  }

  async homepageGroups(limit = 3, now = new Date()) {
    const active = this.loadPublic().filter((o) => isListable(o, now));
    const soonest = (list: OpportunityRecord[]) => [...list].sort(compareByDeadline).slice(0, limit);
    const inScope = (scope: "azerbaijan" | "international") => active.filter((o) => deriveMarketScope(o) === scope);
    return {
      featured: soonest(active.filter((o) => o.featured)),
      azerbaijan: soonest(inScope("azerbaijan")),
      international: soonest(inScope("international")),
    };
  }
}

/** Organizations of the demo data: exactly those with at least one public opportunity. */
export class DemoOrganizationRepository implements OrganizationRepository {
  constructor(private readonly options: { enabled: boolean } = { enabled: true }) {}

  private all(): Organization[] {
    if (!this.options.enabled) return [];
    const byId = new Map(getDemoRecords().filter(isPublic).map((o) => [o.organization.id, o.organization] as const));
    return [...byId.values()];
  }
  async getBySlug(slug: string) {
    return this.all().find((o) => o.slug === slug) ?? null;
  }
  async getById(id: string) {
    return this.all().find((o) => o.id === id) ?? null;
  }
  async listPublic() {
    return this.all();
  }
}
