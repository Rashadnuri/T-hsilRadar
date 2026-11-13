import type { DuplicateIndexEntry } from "@/lib/import/duplicates";
import type { AdminListFilters, AdminListResult, AdminPublicationStatus, AppRole, DashboardStats, ImportBatchSummary, OpportunityFormInput, OrganizationFormInput, QualityReport } from "@/types/admin";
import type { OpportunitySource, SourceFormInput } from "@/types/source";
import type { OpportunityRecord, Organization } from "@/types/opportunity";

/** Who is an admin. Reads the visitor's OWN role rows (row level security allows nothing else). */
export interface RoleRepository {
  getRoles(userId: string): Promise<AppRole[]>;
}

export interface AdminOrganization extends Organization {
  /** Opportunities (any status) that use this organization: it cannot be deleted while > 0. */
  opportunityCount: number;
}

export type AdminFailure = "forbidden" | "not_found" | "conflict" | "in_use" | "publish_blocked" | "invalid" | "failed";

/** Carries only the operation and a coarse reason (never row contents: drafts and notes may be sensitive). */
export class AdminRepositoryError extends Error {
  constructor(readonly operation: string, readonly reason: AdminFailure, readonly constraint?: string) {
    super(`admin ${operation} failed (${reason})`);
    this.name = "AdminRepositoryError";
  }
}

/**
 * Everything the admin area reads and writes. Implementations run under the ADMIN's own session
 * (Supabase: row level security + admin policies; no service-role key) — the server checks the role
 * first, and the database refuses anything a non-admin attempts anyway.
 */
export interface AdminRepository {
  stats(now?: Date): Promise<DashboardStats>;
  list(filters: AdminListFilters, now?: Date): Promise<AdminListResult>;
  /** Any status, every translation (drafts included). */
  get(id: string): Promise<OpportunityRecord | null>;
  /** Creates (always as an unverified draft) or updates the editable fields and translations atomically. Returns the id. */
  save(input: OpportunityFormInput): Promise<string>;
  setPublicationStatus(id: string, status: AdminPublicationStatus): Promise<void>;
  setVerification(id: string, verified: boolean): Promise<void>;
  reviewTranslation(id: string, language: string, status: "human" | "machine_draft" | "machine_approved"): Promise<void>;
  remove(id: string): Promise<void>;

  listOrganizations(): Promise<AdminOrganization[]>;
  getOrganization(id: string): Promise<AdminOrganization | null>;
  saveOrganization(input: OrganizationFormInput): Promise<string>;
  removeOrganization(id: string): Promise<void>;

  // sources, imports and data quality
  listSources(): Promise<OpportunitySource[]>;
  saveSource(input: SourceFormInput): Promise<string>;
  /** Records that a PERSON checked the official page now (never automatic). */
  markSourceChecked(id: string): Promise<void>;
  removeSource(id: string): Promise<void>;
  /** Every existing opportunity reduced to what duplicate detection compares. */
  duplicateIndex(): Promise<DuplicateIndexEntry[]>;
  importBatches(): Promise<ImportBatchSummary[]>;
  /** Provenance of the given records (internal columns). */
  importInfo(ids: string[]): Promise<Record<string, { importBatch: string | null; sourceId: string | null }>>;
  /** Flags verified opportunities whose fixed deadline has passed as expired. Returns how many changed. */
  expireOpportunities(now?: Date): Promise<number>;
  qualityReport(now?: Date): Promise<QualityReport>;
}
