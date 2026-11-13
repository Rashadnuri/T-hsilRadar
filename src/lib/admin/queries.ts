import { getApplicationState } from "@/lib/opportunities/deadline";
import { getOriginalTranslation } from "@/lib/opportunities/translations";
import { foldText } from "@/utils/fold-text";
import { ADMIN_PAGE_SIZE, TRANSLATION_LANGUAGES, type AdminListFilters, type AdminListResult, type DashboardStats } from "@/types/admin";
import type { OpportunityRecord } from "@/types/opportunity";

/** "Expired" as the admin sees it: flagged expired, or a fixed deadline in the past. */
export const isExpiredRecord = (o: OpportunityRecord, now = new Date()) => getApplicationState(o, now) === "expired";

/** Languages (az/ru/en) that have NO usable text: nothing written, or only an unapproved machine draft. */
export function missingTranslationLanguages(o: Pick<OpportunityRecord, "translations">): string[] {
  return TRANSLATION_LANGUAGES.filter((language) => !o.translations.some((t) => t.language === language && t.status !== "machine_draft"));
}

/** The admin list semantics in plain TypeScript (the in-memory development repository uses this; SQL does the same in the database). */
export function filterAdminRecords(records: readonly OpportunityRecord[], filters: AdminListFilters, now = new Date()): OpportunityRecord[] {
  const q = filters.q ? foldText(filters.q.trim()) : "";
  return records
    .filter((o) => !filters.status || o.publicationStatus === filters.status)
    .filter((o) => !filters.verification || o.verificationStatus === filters.verification)
    .filter((o) => !filters.organizationId || o.organizationId === filters.organizationId)
    .filter((o) => !filters.expired || o.verificationStatus === "expired" || (o.deadlineType === "fixed" && o.applicationDeadline !== null && new Date(o.applicationDeadline) < now))
    .filter((o) => !q || o.slug.toLowerCase().includes(q) || o.translations.some((t) => foldText(t.title).includes(q)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export function paginate(items: OpportunityRecord[], page: number, pageSize = ADMIN_PAGE_SIZE): AdminListResult {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  return { items: items.slice((current - 1) * pageSize, current * pageSize), total: items.length, page: current, pageSize, totalPages };
}

export function computeStats(records: readonly OpportunityRecord[], organizations: number, now = new Date()): DashboardStats {
  const byStatus: DashboardStats["byStatus"] = {};
  for (const o of records) byStatus[o.publicationStatus] = (byStatus[o.publicationStatus] ?? 0) + 1;
  return {
    total: records.length,
    byStatus,
    unverified: records.filter((o) => o.verificationStatus !== "verified").length,
    expired: records.filter((o) => o.verificationStatus === "expired" || (o.deadlineType === "fixed" && o.applicationDeadline !== null && new Date(o.applicationDeadline) < now)).length,
    missingTranslations: records.filter((o) => missingTranslationLanguages(o).length > 0).length,
    organizations,
  };
}

/** The title shown in lists: the original-language title. */
export const originalTitle = (o: OpportunityRecord): string => getOriginalTranslation(o)?.title ?? o.slug;
