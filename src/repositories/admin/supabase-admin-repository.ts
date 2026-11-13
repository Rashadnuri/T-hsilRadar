import { CATEGORY_LINK_COLUMNS, OPPORTUNITY_COLUMNS, ORGANIZATION_COLUMNS, TRANSLATION_COLUMNS, type CategoryLinkRow, type OpportunityRow, type OrganizationRow, type QueryError, type SupabaseLike, type TranslationRow } from "@/lib/supabase/types";
import type { DuplicateIndexEntry } from "@/lib/import/duplicates";
import type { AccessMethod, OpportunitySource, SourceFormInput } from "@/types/source";
import { ADMIN_PAGE_SIZE, type AdminListFilters, type AdminListResult, type AdminPublicationStatus, type AppRole, type DashboardStats, type ImportBatchSummary, type QualityReport, type OpportunityFormInput, type OrganizationFormInput } from "@/types/admin";
import type { OpportunityRecord } from "@/types/opportunity";
import { mapOpportunityRecord, mapOrganization } from "../supabase/mappers";
import { AdminRepositoryError, type AdminFailure, type AdminOrganization, type AdminRepository, type RoleRepository } from "./types";

/** SQLSTATE (+ constraint name) → coarse reason. Row contents in database messages are dropped on purpose. */
export function reasonOf(error: QueryError): { reason: AdminFailure; constraint?: string } {
  const constraint = /constraint "([a-z_0-9]+)"/.exec(error.message)?.[1];
  switch (error.code) {
    case "42501": return { reason: "forbidden" };
    case "P0002": return { reason: "not_found" };
    case "23505": return { reason: "conflict", constraint };
    case "23503": return { reason: "in_use", constraint };
    case "23514":
      if (constraint?.startsWith("opportunities_published_") || /short_description|archive a published/.test(error.message)) return { reason: "publish_blocked", constraint };
      return { reason: "invalid", constraint };
    case "22P02": case "22023": case "23502": return { reason: "invalid", constraint };
    default: return { reason: "failed" };
  }
}

const fail = (operation: string, error: QueryError): never => {
  const { reason, constraint } = reasonOf(error);
  throw new AdminRepositoryError(operation, reason, constraint);
};

const SOURCE_COLUMNS = ["id", "organization_name", "website_url", "source_type", "country", "access_method", "last_checked_at", "is_active", "notes", "organization_id", "created_at", "updated_at"] as const;
interface SourceRow {
  id: string; organization_name: string; website_url: string; source_type: OpportunitySource["sourceType"]; country: string | null; access_method: AccessMethod;
  last_checked_at: string | null; is_active: boolean; notes: string | null; organization_id: string | null; created_at: string; updated_at: string;
}
const mapSource = (r: SourceRow): OpportunitySource => ({
  id: r.id, organizationName: r.organization_name, websiteUrl: r.website_url, sourceType: r.source_type, country: r.country, accessMethod: r.access_method,
  lastCheckedAt: r.last_checked_at, isActive: r.is_active, notes: r.notes, organizationId: r.organization_id, createdAt: r.created_at, updatedAt: r.updated_at,
});
export const toSourcePayload = (input: SourceFormInput): Record<string, unknown> => ({
  ...(input.id ? { id: input.id } : {}),
  organization_name: input.organizationName, website_url: input.websiteUrl, source_type: input.sourceType, country: input.country,
  access_method: input.accessMethod, is_active: input.isActive, notes: input.notes, organization_id: input.organizationId,
});

export class SupabaseRoleRepository implements RoleRepository {
  constructor(private readonly db: SupabaseLike) {}
  async getRoles(userId: string): Promise<AppRole[]> {
    const { data, error } = await this.db.from("user_roles").select("role").eq("user_id", userId);
    if (error) throw new AdminRepositoryError("getRoles", reasonOf(error).reason);
    return ((data ?? []) as unknown as { role: AppRole }[]).map((r) => r.role);
  }
}

/** Snake-case payload of the admin_save_opportunity function. */
export function toOpportunityPayload(input: OpportunityFormInput): Record<string, unknown> {
  return {
    ...(input.id ? { id: input.id } : {}),
    slug: input.slug,
    organization_id: input.organizationId,
    opportunity_type: input.opportunityType,
    other_type_label: input.otherTypeLabel,
    location_type: input.locationType,
    country: input.country,
    city_id: input.cityId,
    city_text: input.cityText,
    education_levels: input.educationLevels,
    eligible_fields: input.eligibleFields,
    eligible_countries: input.eligibleCountries,
    funding_type: input.fundingType,
    funding_amount: input.fundingAmount,
    funding_currency: input.fundingCurrency,
    funding_period: input.fundingPeriod,
    funding_percent: input.fundingPercent,
    participation_fee_amount: input.participationFeeAmount,
    participation_fee_currency: input.participationFeeCurrency,
    application_url: input.applicationUrl,
    official_source_url: input.officialSourceUrl,
    application_start_date: input.applicationStartDate,
    application_deadline: input.applicationDeadline,
    deadline_type: input.deadlineType,
    deadline_timezone: input.deadlineTimezone,
    original_language: input.originalLanguage,
    featured: input.featured,
    translations: input.translations.map((t) => ({
      language: t.language, title: t.title, short_description: t.shortDescription, description: t.description,
      requirements: t.requirements, benefits: t.benefits, eligibility: t.eligibility, status: t.status,
    })),
    remove_languages: input.removeLanguages,
    ...(input.sourceId ? { source_id: input.sourceId } : {}),
    ...(input.importBatch ? { import_batch: input.importBatch } : {}),
  };
}

export const toOrganizationPayload = (input: OrganizationFormInput): Record<string, unknown> => ({
  ...(input.id ? { id: input.id } : {}),
  slug: input.slug, kind: input.kind, name: input.name, country: input.country, website_url: input.websiteUrl,
});

/**
 * The admin area's data access through Supabase, as the signed-in ADMIN (never the service-role
 * key). Reads go through RLS admin policies, writes through SECURITY INVOKER functions that
 * change several tables atomically. A non-admin's calls are refused by the database itself.
 */
export class SupabaseAdminRepository implements AdminRepository {
  constructor(private readonly db: SupabaseLike) {}

  async stats(now = new Date()): Promise<DashboardStats> {
    const { data, error } = await this.db.rpc("admin_dashboard_stats", { p_now: now.toISOString() });
    if (error) fail("stats", error);
    const d = data as { total: number; by_status: DashboardStats["byStatus"]; unverified: number; expired: number; missing_translations: number; organizations: number };
    return { total: d.total, byStatus: d.by_status, unverified: d.unverified, expired: d.expired, missingTranslations: d.missing_translations, organizations: d.organizations };
  }

  async list(filters: AdminListFilters, now = new Date()): Promise<AdminListResult> {
    const { data, error } = await this.db.rpc("admin_list_opportunities", {
      p_filters: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.verification ? { verification: filters.verification } : {}),
        ...(filters.expired ? { expired: true } : {}),
        ...(filters.organizationId ? { organization_id: filters.organizationId } : {}),
        ...(filters.batch ? { batch: filters.batch } : {}),
        ...(filters.imported ? { imported: true } : {}),
        ...(filters.q ? { q: filters.q } : {}),
      },
      p_page: filters.page, p_page_size: ADMIN_PAGE_SIZE, p_now: now.toISOString(),
    });
    if (error) fail("list", error);
    const rows = (data ?? []) as { id: string; total_count: number | string; page: number }[];
    const total = rows[0] ? Number(rows[0].total_count) : 0;
    const items = await this.loadByIds(rows.map((r) => r.id));
    return { items, total, page: rows[0]?.page ?? 1, pageSize: ADMIN_PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)) };
  }

  async get(id: string): Promise<OpportunityRecord | null> {
    const { data, error } = await this.db.from("opportunities").select(OPPORTUNITY_COLUMNS.join(",")).eq("id", id).maybeSingle();
    if (error) fail("get", error);
    if (!data) return null;
    return (await this.loadRecords([data as unknown as OpportunityRow]))[0] ?? null;
  }

  async save(input: OpportunityFormInput): Promise<string> {
    const { data, error } = await this.db.rpc("admin_save_opportunity", { p_payload: toOpportunityPayload(input) });
    if (error) fail("save", error);
    return data as string;
  }

  async setPublicationStatus(id: string, status: AdminPublicationStatus): Promise<void> {
    const { error } = await this.db.rpc("admin_set_publication_status", { p_id: id, p_status: status });
    if (error) fail("setPublicationStatus", error);
  }

  async setVerification(id: string, verified: boolean): Promise<void> {
    const { error } = await this.db.rpc("admin_set_verification", { p_id: id, p_verified: verified });
    if (error) fail("setVerification", error);
  }

  async reviewTranslation(id: string, language: string, status: "human" | "machine_draft" | "machine_approved"): Promise<void> {
    const { error } = await this.db.rpc("admin_review_translation", { p_id: id, p_language: language, p_status: status });
    if (error) fail("reviewTranslation", error);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.rpc("admin_delete_opportunity", { p_id: id });
    if (error) fail("remove", error);
  }

  async listOrganizations(): Promise<AdminOrganization[]> {
    const [orgs, counts] = await Promise.all([
      this.db.from("organizations").select(ORGANIZATION_COLUMNS.join(",")).order("name").range(0, 999),
      this.db.from("opportunities").select("organization_id").range(0, 9999),
    ]);
    if (orgs.error) fail("listOrganizations", orgs.error);
    if (counts.error) fail("listOrganizations", counts.error);
    const used = new Map<string, number>();
    for (const row of (counts.data ?? []) as unknown as { organization_id: string }[]) used.set(row.organization_id, (used.get(row.organization_id) ?? 0) + 1);
    return ((orgs.data ?? []) as unknown as OrganizationRow[]).map((row) => ({ ...mapOrganization(row), opportunityCount: used.get(row.id) ?? 0 }));
  }

  async getOrganization(id: string): Promise<AdminOrganization | null> {
    return (await this.listOrganizations()).find((o) => o.id === id) ?? null;
  }

  async saveOrganization(input: OrganizationFormInput): Promise<string> {
    const { data, error } = await this.db.rpc("admin_save_organization", { p_payload: toOrganizationPayload(input) });
    if (error) fail("saveOrganization", error);
    return data as string;
  }

  async removeOrganization(id: string): Promise<void> {
    const { error } = await this.db.rpc("admin_delete_organization", { p_id: id });
    if (error) fail("removeOrganization", error);
  }

  // ── sources, imports, data quality ─────────────────────────────────────────────────────────

  async listSources(): Promise<OpportunitySource[]> {
    const { data, error } = await this.db.from("opportunity_sources").select(SOURCE_COLUMNS.join(",")).order("organization_name").range(0, 999);
    if (error) fail("listSources", error);
    return ((data ?? []) as unknown as SourceRow[]).map(mapSource);
  }

  async saveSource(input: SourceFormInput): Promise<string> {
    const { data, error } = await this.db.rpc("admin_save_source", { p_payload: toSourcePayload(input) });
    if (error) fail("saveSource", error);
    return data as string;
  }

  async markSourceChecked(id: string): Promise<void> {
    const { error } = await this.db.rpc("admin_mark_source_checked", { p_id: id });
    if (error) fail("markSourceChecked", error);
  }

  async removeSource(id: string): Promise<void> {
    const { error } = await this.db.rpc("admin_delete_source", { p_id: id });
    if (error) fail("removeSource", error);
  }

  async duplicateIndex(): Promise<DuplicateIndexEntry[]> {
    const { data, error } = await this.db.rpc("admin_duplicate_index");
    if (error) fail("duplicateIndex", error);
    return ((data ?? []) as { id: string; slug: string; organization_id: string; official_source_url: string | null; application_deadline: string | null; status: string; titles: string[] }[]).map((r) => ({
      id: r.id, slug: r.slug, organizationId: r.organization_id, officialSourceUrl: r.official_source_url, applicationDeadline: r.application_deadline, status: r.status, titles: r.titles ?? [],
    }));
  }

  async importBatches(): Promise<ImportBatchSummary[]> {
    const { data, error } = await this.db.rpc("admin_import_batches");
    if (error) fail("importBatches", error);
    return ((data ?? []) as { batch: string; total: number; draft: number; in_review: number; published: number; other: number; last_at: string }[]).map((b) => ({
      batch: b.batch, total: b.total, draft: b.draft, inReview: b.in_review, published: b.published, other: b.other, lastAt: b.last_at,
    }));
  }

  async importInfo(ids: string[]): Promise<Record<string, { importBatch: string | null; sourceId: string | null }>> {
    if (ids.length === 0) return {};
    const { data, error } = await this.db.from("opportunities").select("id,import_batch,source_id").in("id", ids);
    if (error) fail("importInfo", error);
    return Object.fromEntries(((data ?? []) as unknown as { id: string; import_batch: string | null; source_id: string | null }[]).map((r) => [r.id, { importBatch: r.import_batch, sourceId: r.source_id }]));
  }

  async expireOpportunities(now = new Date()): Promise<number> {
    const { data, error } = await this.db.rpc("admin_expire_opportunities", { p_now: now.toISOString() });
    if (error) fail("expireOpportunities", error);
    return Number(data ?? 0);
  }

  async qualityReport(now = new Date()): Promise<QualityReport> {
    const { data, error } = await this.db.rpc("admin_quality_report", { p_now: now.toISOString() });
    if (error) fail("qualityReport", error);
    const d = data as { expired_unflagged: string[]; stale_verification: string[]; sources_overdue: string[]; published_missing_translations: string[] };
    return { expiredUnflagged: d.expired_unflagged, staleVerification: d.stale_verification, sourcesOverdue: d.sources_overdue, publishedMissingTranslations: d.published_missing_translations };
  }

  // ── internals ───────────────────────────────────────────────────────────────────────────────

  private async loadByIds(ids: string[]): Promise<OpportunityRecord[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.db.from("opportunities").select(OPPORTUNITY_COLUMNS.join(",")).in("id", ids);
    if (error) fail("load", error);
    const byId = new Map(((data ?? []) as unknown as OpportunityRow[]).map((r) => [r.id, r] as const));
    return this.loadRecords(ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
  }

  private async rows<T>(table: string, columns: readonly string[], column: string, values: string[]): Promise<T[]> {
    if (values.length === 0) return [];
    const { data, error } = await this.db.from(table).select(columns.join(",")).in(column, values);
    if (error) fail(`select ${table}`, error);
    return (data ?? []) as unknown as T[];
  }

  private async loadRecords(rows: OpportunityRow[]): Promise<OpportunityRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const orgIds = [...new Set(rows.map((r) => r.organization_id))];
    const [orgs, translations, links] = await Promise.all([
      this.rows<OrganizationRow>("organizations", ORGANIZATION_COLUMNS, "id", orgIds),
      this.rows<TranslationRow>("opportunity_translations", TRANSLATION_COLUMNS, "opportunity_id", ids),
      this.rows<CategoryLinkRow>("opportunity_categories", CATEGORY_LINK_COLUMNS, "opportunity_id", ids),
    ]);
    const orgById = new Map(orgs.map((o) => [o.id, mapOrganization(o)] as const));
    return rows.flatMap((row) => {
      const organization = orgById.get(row.organization_id);
      return organization ? [mapOpportunityRecord(row, organization, translations.filter((t) => t.opportunity_id === row.id), links.filter((l) => l.opportunity_id === row.id))] : [];
    });
  }
}
