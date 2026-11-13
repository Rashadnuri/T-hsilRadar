import { randomUUID } from "node:crypto";
import { getDemoRecords } from "@/features/opportunities/demo-data";
import { computeStats, filterAdminRecords, missingTranslationLanguages, paginate } from "@/lib/admin/queries";
import { getPublicationBlockers } from "@/lib/opportunities/status";
import { applyOriginalEdit, getOriginalTranslation } from "@/lib/opportunities/translations";
import { AdminRepositoryError, type AdminOrganization, type AdminRepository, type RoleRepository } from "@/repositories/admin/types";
import type { DuplicateIndexEntry } from "@/lib/import/duplicates";
import type { AdminListFilters, AppRole, ImportBatchSummary, OpportunityFormInput, OrganizationFormInput, QualityReport } from "@/types/admin";
import { SOURCE_STALE_DAYS, type OpportunitySource, type SourceFormInput } from "@/types/source";
import type { OpportunityRecord, Organization } from "@/types/opportunity";
import type { OpportunityTranslation } from "@/types/translation";
import { fakeState } from "./store";

/**
 * DEVELOPMENT / TEST ONLY: the admin repository in memory, seeded with the labelled demo records,
 * so the admin UI can be exercised without a database. It mirrors the rules the real functions and
 * constraints enforce (draft on create, publishing requirements, original preserved, translation
 * statuses); those rules are verified against real PostgreSQL in supabase/tests/admin*.test.ts.
 * It is never used in production (the fake auth module refuses to load there).
 */
interface AdminStore {
  records: Map<string, OpportunityRecord>;
  organizations: Map<string, Organization>;
  audit: { actor: string; action: string; entityId: string | null; at: string }[];
  sources: Map<string, OpportunitySource>;
  importInfo: Map<string, { importBatch: string | null; sourceId: string | null }>;
}
const KEY = Symbol.for("tahsilradar.fake-admin-store");
const holder = globalThis as unknown as Record<symbol, AdminStore | undefined>;

function store(): AdminStore {
  const existing = holder[KEY];
  if (existing) return existing;
  const records = new Map<string, OpportunityRecord>();
  const organizations = new Map<string, Organization>();
  for (const r of getDemoRecords()) {
    records.set(r.id, structuredClone(r));
    organizations.set(r.organization.id, r.organization);
  }
  return (holder[KEY] = { records, organizations, audit: [], sources: new Map(), importInfo: new Map() });
}

export const getFakeAdminAudit = () => store().audit;

/** Admins in development: the emails listed in FAKE_ADMIN_EMAILS (comma-separated). Everyone else is a regular user. */
export function createFakeRoles(): RoleRepository {
  return {
    async getRoles(userId): Promise<AppRole[]> {
      const email = fakeState.users.get(userId)?.email.toLowerCase();
      const admins = (process.env.FAKE_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
      return email && admins.includes(email) ? ["admin"] : [];
    },
  };
}

const now = () => new Date().toISOString();
const fail = (operation: string, reason: ConstructorParameters<typeof AdminRepositoryError>[1]): never => {
  throw new AdminRepositoryError(operation, reason);
};

export function createFakeAdmin(actorId: string): AdminRepository {
  const s = store();
  const audit = (action: string, entityId: string | null) => s.audit.push({ actor: actorId, action, entityId, at: now() });
  const need = (id: string, operation: string) => s.records.get(id) ?? fail(operation, "not_found");
  const clone = <T,>(v: T): T => structuredClone(v);
  const orgCount = (id: string) => [...s.records.values()].filter((r) => r.organizationId === id).length;
  const asAdminOrg = (o: Organization): AdminOrganization => ({ ...o, opportunityCount: orgCount(o.id) });

  const newTranslation = (id: string, t: OpportunityFormInput["translations"][number], original: string, version: number): OpportunityTranslation => ({
    opportunityId: id, language: t.language, title: t.title, shortDescription: t.shortDescription, description: t.description, requirements: t.requirements,
    benefits: t.benefits, eligibility: t.eligibility, status: t.status, translatedFrom: t.status === "original" ? null : original, sourceVersion: version,
    translatedBy: null, reviewedBy: null, reviewedAt: null, createdAt: now(), updatedAt: now(),
  });

  return {
    async stats(at = new Date()) {
      return computeStats([...s.records.values()], s.organizations.size, at);
    },
    async list(filters: AdminListFilters, at = new Date()) {
      let records = [...s.records.values()];
      if (filters.batch) records = records.filter((r) => s.importInfo.get(r.id)?.importBatch === filters.batch);
      if (filters.imported) records = records.filter((r) => s.importInfo.get(r.id)?.importBatch);
      return paginate(filterAdminRecords(records, filters, at), filters.page);
    },
    async get(id) {
      const r = s.records.get(id);
      return r ? clone(r) : null;
    },
    async save(input) {
      const org = s.organizations.get(input.organizationId) ?? fail("save", "invalid");
      if ([...s.records.values()].some((r) => r.slug === input.slug && r.id !== input.id)) fail("save", "conflict");
      const editable = {
        slug: input.slug, organizationId: input.organizationId, opportunityType: input.opportunityType, otherTypeLabel: input.otherTypeLabel, locationType: input.locationType,
        country: input.country, cityId: input.cityId, cityText: input.cityText, educationLevels: input.educationLevels, eligibleFields: input.eligibleFields,
        eligibleCountries: input.eligibleCountries, fundingType: input.fundingType, fundingAmount: input.fundingAmount, fundingCurrency: input.fundingCurrency,
        fundingPeriod: input.fundingPeriod, fundingPercent: input.fundingPercent, participationFeeAmount: input.participationFeeAmount,
        participationFeeCurrency: input.participationFeeCurrency, applicationUrl: input.applicationUrl, officialSourceUrl: input.officialSourceUrl,
        applicationStartDate: input.applicationStartDate, applicationDeadline: input.applicationDeadline, deadlineType: input.deadlineType,
        deadlineTimezone: input.deadlineTimezone, featured: input.featured,
      };
      let record: OpportunityRecord;
      if (!input.id) {
        if (!input.translations.some((t) => t.status === "original" && t.language === input.originalLanguage)) fail("save", "invalid");
        const id = randomUUID();
        const t0 = now();
        record = {
          id, ...editable, organization: org, translations: [], categories: [input.opportunityType], publicationStatus: "draft", verificationStatus: "unverified",
          lastVerifiedAt: null, verifiedBy: null, originalLanguage: input.originalLanguage, contentVersion: 1, isDemo: false, publishedAt: null, createdBy: actorId, createdAt: t0, updatedAt: t0,
        };
      } else {
        record = clone(need(input.id, "save"));
        Object.assign(record, editable, { organization: org, categories: [input.opportunityType], updatedAt: now() });
        if (record.publicationStatus === "published" && getPublicationBlockers(record).some((b) => b !== "already_expired")) fail("save", "publish_blocked");
      }
      // Pass 1: the original (an edit outdates the others); pass 2: the other languages.
      const writeOriginal = input.translations.find((t) => t.status === "original");
      if (writeOriginal) {
        const existing = getOriginalTranslation(record);
        const changed = existing && (["title", "shortDescription", "description", "requirements", "benefits", "eligibility"] as const).some((f) => existing[f] !== writeOriginal[f]);
        if (changed) record = applyOriginalEdit(record);
        record.translations = record.translations.filter((t) => t.status !== "original");
        record.translations.push(newTranslation(record.id, writeOriginal, record.originalLanguage, record.contentVersion));
      }
      for (const t of input.translations.filter((x) => x.status !== "original")) {
        record.translations = record.translations.filter((x) => x.language !== t.language);
        record.translations.push(newTranslation(record.id, t, record.originalLanguage, record.contentVersion));
      }
      record.translations = record.translations.filter((t) => t.status === "original" || !input.removeLanguages.includes(t.language));
      s.records.set(record.id, record);
      if (!input.id && (input.importBatch || input.sourceId)) s.importInfo.set(record.id, { importBatch: input.importBatch ?? null, sourceId: input.sourceId ?? null });
      audit("opportunity.save", record.id);
      return record.id;
    },
    async setPublicationStatus(id, status) {
      const r = clone(need(id, "setPublicationStatus"));
      r.publicationStatus = status;
      if (status === "published") {
        if (getPublicationBlockers(r).some((b) => b !== "already_expired")) fail("setPublicationStatus", "publish_blocked");
        r.publishedAt ??= now();
      }
      r.updatedAt = now();
      s.records.set(id, r);
      audit("opportunity.status", id);
    },
    async setVerification(id, verified) {
      const r = clone(need(id, "setVerification"));
      if (!verified && r.publicationStatus === "published" && !r.isDemo) fail("setVerification", "publish_blocked");
      r.verificationStatus = verified ? "verified" : "unverified";
      r.verifiedBy = verified ? actorId : null;
      r.lastVerifiedAt = verified ? now() : null;
      r.updatedAt = now();
      s.records.set(id, r);
      audit("opportunity.verify", id);
    },
    async reviewTranslation(id, language, status) {
      const r = clone(need(id, "reviewTranslation"));
      const t = r.translations.find((x) => x.language === language && x.status !== "original") ?? fail("reviewTranslation", "not_found");
      t.status = status;
      t.reviewedAt = now();
      r.updatedAt = now();
      s.records.set(id, r);
      audit("translation.review", id);
    },
    async remove(id) {
      const r = need(id, "remove");
      if (r.publicationStatus === "published") fail("remove", "publish_blocked");
      s.records.delete(id);
      audit("opportunity.delete", id);
    },
    async listOrganizations() {
      return [...s.organizations.values()].map(asAdminOrg).sort((a, b) => a.name.localeCompare(b.name));
    },
    async getOrganization(id) {
      const o = s.organizations.get(id);
      return o ? asAdminOrg(o) : null;
    },
    async saveOrganization(input: OrganizationFormInput) {
      if ([...s.organizations.values()].some((o) => o.slug === input.slug && o.id !== input.id)) fail("saveOrganization", "conflict");
      const id = input.id ?? randomUUID();
      if (input.id && !s.organizations.has(input.id)) fail("saveOrganization", "not_found");
      const org: Organization = { id, slug: input.slug, name: input.name, kind: input.kind, country: input.country, websiteUrl: input.websiteUrl, isDemo: false };
      s.organizations.set(id, org);
      for (const r of s.records.values()) if (r.organizationId === id) r.organization = org;
      audit("organization.save", id);
      return id;
    },
    async listSources() {
      return [...s.sources.values()].sort((a, b) => a.organizationName.localeCompare(b.organizationName));
    },
    async saveSource(input: SourceFormInput) {
      if ([...s.sources.values()].some((x) => x.websiteUrl === input.websiteUrl && x.id !== input.id)) fail("saveSource", "conflict");
      const t = now();
      const existing = input.id ? (s.sources.get(input.id) ?? fail("saveSource", "not_found")) : null;
      const id = input.id ?? randomUUID();
      s.sources.set(id, {
        id, organizationName: input.organizationName, websiteUrl: input.websiteUrl, sourceType: input.sourceType, country: input.country, accessMethod: input.accessMethod, isActive: input.isActive,
        notes: input.notes, organizationId: input.organizationId, lastCheckedAt: existing?.lastCheckedAt ?? null, createdAt: existing?.createdAt ?? t, updatedAt: t,
      });
      audit("source.save", id);
      return id;
    },
    async markSourceChecked(id) {
      const src = s.sources.get(id) ?? fail("markSourceChecked", "not_found");
      s.sources.set(id, { ...src, lastCheckedAt: now(), updatedAt: now() });
      audit("source.checked", id);
    },
    async removeSource(id) {
      if (!s.sources.delete(id)) fail("removeSource", "not_found");
      for (const [k, v] of s.importInfo) if (v.sourceId === id) s.importInfo.set(k, { ...v, sourceId: null });
      audit("source.delete", id);
    },
    async duplicateIndex(): Promise<DuplicateIndexEntry[]> {
      return [...s.records.values()].map((r) => ({ id: r.id, slug: r.slug, organizationId: r.organizationId, officialSourceUrl: r.officialSourceUrl, applicationDeadline: r.applicationDeadline, status: r.publicationStatus, titles: r.translations.map((t) => t.title) }));
    },
    async importBatches(): Promise<ImportBatchSummary[]> {
      const groups = new Map<string, ImportBatchSummary>();
      for (const [id, info] of s.importInfo) {
        const r = s.records.get(id);
        if (!info.importBatch || !r) continue;
        const g = groups.get(info.importBatch) ?? { batch: info.importBatch, total: 0, draft: 0, inReview: 0, published: 0, other: 0, lastAt: r.createdAt };
        g.total++;
        if (r.publicationStatus === "draft") g.draft++;
        else if (r.publicationStatus === "in_review") g.inReview++;
        else if (r.publicationStatus === "published") g.published++;
        else g.other++;
        if (r.createdAt > g.lastAt) g.lastAt = r.createdAt;
        groups.set(info.importBatch, g);
      }
      return [...groups.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    },
    async importInfo(ids) {
      return Object.fromEntries(ids.flatMap((id) => (s.importInfo.has(id) ? [[id, s.importInfo.get(id)!]] : [])));
    },
    async expireOpportunities(at = new Date()) {
      let n = 0;
      for (const r of s.records.values()) {
        if (r.verificationStatus === "verified" && r.deadlineType === "fixed" && r.applicationDeadline && new Date(r.applicationDeadline) < at) {
          r.verificationStatus = "expired";
          n++;
        }
      }
      audit("opportunity.expire_check", null);
      return n;
    },
    async qualityReport(at = new Date()): Promise<QualityReport> {
      const staleBefore = at.getTime() - SOURCE_STALE_DAYS * 86_400_000;
      const records = [...s.records.values()];
      return {
        expiredUnflagged: records.filter((r) => r.verificationStatus === "verified" && r.deadlineType === "fixed" && r.applicationDeadline && new Date(r.applicationDeadline) < at).map((r) => r.id),
        staleVerification: records.filter((r) => r.verificationStatus === "verified" && r.lastVerifiedAt && new Date(r.lastVerifiedAt).getTime() < staleBefore).map((r) => r.id),
        sourcesOverdue: [...s.sources.values()].filter((x) => x.isActive && (!x.lastCheckedAt || new Date(x.lastCheckedAt).getTime() < staleBefore)).map((x) => x.id),
        publishedMissingTranslations: records.filter((r) => r.publicationStatus === "published" && missingTranslationLanguages(r).length > 0).map((r) => r.id),
      };
    },
    async removeOrganization(id) {
      if (!s.organizations.has(id)) fail("removeOrganization", "not_found");
      if (orgCount(id) > 0) fail("removeOrganization", "in_use");
      s.organizations.delete(id);
      audit("organization.delete", id);
    },
  };
}
