import { PAGE_SIZE } from "@/repositories/demo/demo-repository";
import type { Facets } from "@/lib/opportunities/search";
import { isPublic } from "@/lib/opportunities/status";
import {
  CATEGORY_LINK_COLUMNS, OPPORTUNITY_COLUMNS, ORGANIZATION_COLUMNS, TRANSLATION_COLUMNS,
  type CategoryLinkRow, type OpportunityRow, type OrganizationRow, type QueryError, type SearchPageRow, type SupabaseLike, type TranslationRow,
} from "@/lib/supabase/types";
import type { OpportunityRecord, Organization, Paginated } from "@/types/opportunity";
import type { OpportunityFilters } from "@/validation/opportunity-filters";
import type { FilterOptions, HomepageGroups, OpportunityRepository, OrganizationRepository, SearchOptions } from "../types";
import { mapOpportunityRecord, mapOrganization } from "./mappers";
import { buildSearchFilters, type SearchExtras } from "./search-params";

export class RepositoryError extends Error {
  constructor(operation: string, cause: QueryError) {
    super(`Supabase ${operation} failed: ${cause.message}`);
    this.name = "RepositoryError";
  }
}

export interface SupabaseRepositoryOptions {
  /** false → demo records are excluded in every query (SHOW_DEMO_CONTENT=false). */
  includeDemo: boolean;
}

const DEFAULT_GROUP_SIZE = 3;
const MAX_BY_IDS = 500; // the per-user plan limit
const MAX_SLUGS = 1000; // PostgREST's default row cap; static generation only needs the public set.

/**
 * Reads public opportunities through Supabase using the ANON role only, so row level security
 * is always in force. Filtering, search, sorting and pagination run in the database
 * (search_opportunities / catalogue_facets / catalogue_filter_options); this class loads the
 * rows for one page, maps them to the domain model and, as defence in depth, re-checks
 * `isPublic` on every record it returns.
 */
export class SupabaseOpportunityRepository implements OpportunityRepository {
  constructor(private readonly db: SupabaseLike, private readonly options: SupabaseRepositoryOptions = { includeDemo: true }) {}

  async search(filters: OpportunityFilters, { pageSize = PAGE_SIZE, now = new Date() }: SearchOptions = {}): Promise<Paginated<OpportunityRecord>> {
    const { rows, records } = await this.searchPage(buildSearchFilters(filters, this.extras()), filters.page, pageSize, now);
    const first = rows[0];
    const total = first ? Number(first.total_count) : 0;
    return { items: records, total, page: first?.page ?? 1, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async facets(filters: OpportunityFilters, now = new Date()): Promise<Facets> {
    const data = await this.rpc<Facets>("catalogue_facets", { p_filters: buildSearchFilters(filters, this.extras()), p_now: now.toISOString() });
    return data;
  }

  async filterOptions(): Promise<FilterOptions> {
    return this.rpc<FilterOptions>("catalogue_filter_options", { p_exclude_demo: !this.options.includeDemo });
  }

  async getBySlug(slug: string): Promise<OpportunityRecord | null> {
    let query = this.db.from("opportunities").select(OPPORTUNITY_COLUMNS.join(",")).eq("slug", slug);
    if (!this.options.includeDemo) query = query.eq("is_demo", false);
    const { data, error } = await query.maybeSingle();
    if (error) throw new RepositoryError("getBySlug", error);
    if (!data) return null;
    const [record] = await this.loadRecords([data as unknown as OpportunityRow]);
    return record && isPublic(record) ? record : null;
  }

  async getByIds(ids: readonly string[]): Promise<OpportunityRecord[]> {
    const unique = [...new Set(ids)].slice(0, MAX_BY_IDS);
    if (unique.length === 0) return [];
    const rows = await this.fetchRows<OpportunityRow>("opportunities", OPPORTUNITY_COLUMNS, "id", unique);
    const wanted = this.options.includeDemo ? rows : rows.filter((r) => !r.is_demo);
    const byId = new Map(wanted.map((r) => [r.id, r] as const));
    return this.loadRecords(unique.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
  }

  async listSlugs(): Promise<string[]> {
    let query = this.db.from("opportunities").select("slug").order("slug").range(0, MAX_SLUGS - 1);
    if (!this.options.includeDemo) query = query.eq("is_demo", false);
    const { data, error } = await query;
    if (error) throw new RepositoryError("listSlugs", error);
    return ((data ?? []) as unknown as { slug: string }[]).map((r) => r.slug);
  }

  async homepageGroups(limit = DEFAULT_GROUP_SIZE, now = new Date()): Promise<HomepageGroups> {
    const group = async (extra: Record<string, unknown>) => {
      const filters = { ...buildSearchFilters({ page: 1 }, this.extras()), sort: "deadline", ...extra };
      return (await this.searchPage(filters, 1, limit, now)).records;
    };
    const [featured, azerbaijan, international] = await Promise.all([
      group({ featured: true }),
      group({ scope: "azerbaijan", scope_exact: true }),
      group({ scope: "international", scope_exact: true }),
    ]);
    return { featured, azerbaijan, international };
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────

  private extras(): SearchExtras {
    return { excludeDemo: !this.options.includeDemo };
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) throw new RepositoryError(fn, error);
    return data as T;
  }

  /** One RPC for the ids of a page, then the rows for those ids (in the RPC's order). */
  private async searchPage(filters: Record<string, unknown>, page: number, pageSize: number, now: Date) {
    const rows = (await this.rpc<SearchPageRow[] | null>("search_opportunities", {
      p_filters: filters, p_page: page, p_page_size: pageSize, p_now: now.toISOString(),
    })) ?? [];
    if (rows.length === 0) return { rows, records: [] as OpportunityRecord[] };
    const opportunityRows = await this.fetchRows<OpportunityRow>("opportunities", OPPORTUNITY_COLUMNS, "id", rows.map((r) => r.id));
    const byId = new Map(opportunityRows.map((r) => [r.id, r] as const));
    const ordered = rows.flatMap((r) => (byId.has(r.id) ? [byId.get(r.id)!] : []));
    return { rows, records: await this.loadRecords(ordered) };
  }

  private async fetchRows<T>(table: string, columns: readonly string[], column: string, values: readonly string[]): Promise<T[]> {
    if (values.length === 0) return [];
    const { data, error } = await this.db.from(table).select(columns.join(",")).in(column, values);
    if (error) throw new RepositoryError(`select ${table}`, error);
    return (data ?? []) as unknown as T[];
  }

  /** Organization + translations + category links for a set of opportunity rows; order preserved. */
  private async loadRecords(rows: OpportunityRow[]): Promise<OpportunityRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const orgIds = [...new Set(rows.map((r) => r.organization_id))];
    const [orgs, translations, links] = await Promise.all([
      this.fetchRows<OrganizationRow>("organizations", ORGANIZATION_COLUMNS, "id", orgIds),
      this.fetchRows<TranslationRow>("opportunity_translations", TRANSLATION_COLUMNS, "opportunity_id", ids),
      this.fetchRows<CategoryLinkRow>("opportunity_categories", CATEGORY_LINK_COLUMNS, "opportunity_id", ids),
    ]);
    const orgById = new Map(orgs.map((o) => [o.id, mapOrganization(o)] as const));
    return rows.flatMap((row) => {
      const organization = orgById.get(row.organization_id);
      if (!organization) return []; // not visible to this role: never return a record without its organization
      const record = mapOpportunityRecord(
        row, organization,
        translations.filter((t) => t.opportunity_id === row.id),
        links.filter((l) => l.opportunity_id === row.id),
      );
      return isPublic(record) ? [record] : [];
    });
  }
}

export class SupabaseOrganizationRepository implements OrganizationRepository {
  constructor(private readonly db: SupabaseLike, private readonly options: SupabaseRepositoryOptions = { includeDemo: true }) {}

  private async query(operation: string, apply: (q: ReturnType<ReturnType<SupabaseLike["from"]>["select"]>) => ReturnType<ReturnType<SupabaseLike["from"]>["select"]>): Promise<Organization[]> {
    let q = apply(this.db.from("organizations").select(ORGANIZATION_COLUMNS.join(",")));
    if (!this.options.includeDemo) q = q.eq("is_demo", false);
    const { data, error } = await q;
    if (error) throw new RepositoryError(operation, error);
    return ((data ?? []) as unknown as OrganizationRow[]).map(mapOrganization);
  }

  async getBySlug(slug: string) {
    return (await this.query("organizations.getBySlug", (q) => q.eq("slug", slug)))[0] ?? null;
  }
  async getById(id: string) {
    return (await this.query("organizations.getById", (q) => q.eq("id", id)))[0] ?? null;
  }
  async listPublic() {
    return this.query("organizations.listPublic", (q) => q.order("name"));
  }
}
