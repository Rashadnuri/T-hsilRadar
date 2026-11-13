import type { OrganizationKind } from "./opportunity";

/**
 * HOW the information is obtained. The platform prefers official APIs and authorized feeds; it does
 * NOT scrape websites. "manual" = a person reads the official page and enters or imports the data.
 */
export const ACCESS_METHODS = ["official_api", "authorized_feed", "official_website", "manual"] as const;
export type AccessMethod = (typeof ACCESS_METHODS)[number];

export interface OpportunitySource {
  id: string;
  organizationName: string;
  websiteUrl: string;
  /** The kind of organization the source belongs to (government, university, bank, IT company, NGO…). */
  sourceType: OrganizationKind;
  country: string | null;
  accessMethod: AccessMethod;
  /** Set by a person who opened the official page: never by a crawler. */
  lastCheckedAt: string | null;
  isActive: boolean;
  notes: string | null;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceFormInput {
  id?: string;
  organizationName: string;
  websiteUrl: string;
  sourceType: OrganizationKind;
  country: string | null;
  accessMethod: AccessMethod;
  isActive: boolean;
  notes: string | null;
  organizationId: string | null;
}

/** A source is overdue when nobody has checked its official page for this many days. */
export const SOURCE_STALE_DAYS = 90;

/** A source is overdue when it is active and its official page was never checked, or not within SOURCE_STALE_DAYS. */
export const isSourceOverdue = (s: Pick<OpportunitySource, "isActive" | "lastCheckedAt">, now: Date): boolean =>
  s.isActive && (s.lastCheckedAt === null || new Date(s.lastCheckedAt).getTime() < now.getTime() - SOURCE_STALE_DAYS * 86_400_000);
