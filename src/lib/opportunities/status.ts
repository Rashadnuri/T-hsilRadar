import type {
  Opportunity,
  OpportunityRecord,
  PublicationStatus,
  VerificationStatus,
} from "@/types/opportunity";
import { isDeadlinePassed, isExpired } from "./deadline";
import { getOriginalTranslation } from "./translations";

// ── State machines ──────────────────────────────────────────────────────────────────────────

const VERIFICATION_TRANSITIONS: Record<VerificationStatus, readonly VerificationStatus[]> = {
  unverified: ["verified", "rejected"],
  verified: ["unverified", "expired"], // unverified: a critical field changed; expired: ended
  rejected: ["unverified"], // resubmitted after corrections
  expired: ["unverified", "verified"], // re-opened / re-verified for a new round
};

const PUBLICATION_TRANSITIONS: Record<PublicationStatus, readonly PublicationStatus[]> = {
  // Publishing always passes through review: a draft is submitted first, then approved (or rejected).
  draft: ["in_review", "archived"],
  in_review: ["draft", "published", "rejected", "archived"],
  published: ["draft", "unpublished", "archived"],
  rejected: ["draft", "in_review", "archived"],
  unpublished: ["draft", "in_review", "published", "archived"],
  archived: ["draft"],
};

export const canTransitionVerification = (from: VerificationStatus, to: VerificationStatus) =>
  VERIFICATION_TRANSITIONS[from].includes(to);

export const canTransitionPublication = (from: PublicationStatus, to: PublicationStatus) =>
  PUBLICATION_TRANSITIONS[from].includes(to);

// ── Visibility ──────────────────────────────────────────────────────────────────────────────

type StatusFields = Pick<Opportunity, "publicationStatus" | "verificationStatus" | "isDemo">;

/**
 * May the public see this record at all (direct link)? Published AND verified (or previously
 * verified and since expired). Demo records are the only exception: they are visible but flagged
 * and never claim to be verified.
 */
export function isPublic(o: StatusFields): boolean {
  if (o.publicationStatus !== "published") return false;
  return o.isDemo || o.verificationStatus === "verified" || o.verificationStatus === "expired";
}

/** Should it appear in lists/search/home as an active opportunity? Public AND not expired. */
export function isListable(o: StatusFields & Parameters<typeof isExpired>[0], now = new Date()): boolean {
  return isPublic(o) && !isExpired(o, now);
}

/** A stored "verified" whose deadline has passed is effectively "expired". */
export function getEffectiveVerificationStatus(
  o: Pick<Opportunity, "verificationStatus" | "applicationDeadline" | "deadlineType">,
  now = new Date(),
): VerificationStatus {
  return o.verificationStatus === "verified" && isDeadlinePassed(o, now) ? "expired" : o.verificationStatus;
}

// ── Publication rules ───────────────────────────────────────────────────────────────────────

export type PublicationBlocker =
  | "missing_official_source"
  | "official_source_not_https"
  | "not_verified"
  | "missing_organization"
  | "missing_original_translation"
  | "missing_title"
  | "missing_short_description"
  | "deadline_required"
  | "deadline_not_stated"
  | "missing_country"
  | "already_expired";

/** Everything stopping this record from being published. Empty array = publishable. */
export function getPublicationBlockers(record: OpportunityRecord, now = new Date(), options: { verifierReadable?: boolean } = {}): PublicationBlocker[] {
  const blockers: PublicationBlocker[] = [];
  if (!record.officialSourceUrl) blockers.push("missing_official_source");
  else if (!record.officialSourceUrl.startsWith("https://")) blockers.push("official_source_not_https");
  // The verifier id is a hidden column in the admin API (the database requires it and stamps it itself), so admin code passes verifierReadable: false.
  const verifierMissing = options.verifierReadable === false ? false : !record.verifiedBy;
  if (!record.isDemo && (record.verificationStatus !== "verified" || verifierMissing || !record.lastVerifiedAt)) {
    blockers.push("not_verified");
  }
  if (!record.organization?.id || record.organization.id !== record.organizationId) blockers.push("missing_organization");

  const original = getOriginalTranslation(record);
  if (!original) blockers.push("missing_original_translation");
  else {
    if (!original.title.trim()) blockers.push("missing_title");
    if (!original.shortDescription?.trim()) blockers.push("missing_short_description");
  }
  if (record.deadlineType === "fixed" && !record.applicationDeadline) blockers.push("deadline_required");
  // "Unknown" is not a statement: publishing needs a date or an explicit "rolling / no deadline" (demo records are exempt).
  if (record.deadlineType === "unknown" && !record.isDemo) blockers.push("deadline_not_stated");
  // A host country is required (remote opportunities may have none).
  if (!record.country && record.locationType !== "remote") blockers.push("missing_country");
  if (isExpired(record, now)) blockers.push("already_expired");
  return blockers;
}

export const canPublish = (record: OpportunityRecord, now = new Date()) => getPublicationBlockers(record, now).length === 0;

// ── Edits that invalidate verification ──────────────────────────────────────────────────────

/** Facts whose change means the verification no longer vouches for the record (SECURITY.md §5). */
export const CRITICAL_FIELDS = [
  "officialSourceUrl",
  "applicationUrl",
  "applicationDeadline",
  "applicationStartDate",
  "deadlineType",
  "fundingType",
  "fundingAmount",
  "fundingCurrency",
  "fundingPercent",
  "eligibleCountries",
  "educationLevels",
  "organizationId",
] as const satisfies readonly (keyof Opportunity)[];

export function changedCriticalFields(previous: Opportunity, next: Opportunity): (typeof CRITICAL_FIELDS)[number][] {
  return CRITICAL_FIELDS.filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
}

/** Verification status after an edit: a verified record with changed critical facts goes back to unverified. */
export function verificationAfterEdit(previous: Opportunity, next: Opportunity): VerificationStatus {
  return previous.verificationStatus === "verified" && changedCriticalFields(previous, next).length > 0
    ? "unverified"
    : previous.verificationStatus;
}
