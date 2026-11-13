import { describe, expect, it } from "vitest";
import {
  canPublish, canTransitionPublication, canTransitionVerification, changedCriticalFields, getEffectiveVerificationStatus, getPublicationBlockers, isListable, isPublic, verificationAfterEdit,
} from "../status";
import { makeRecord, makeTranslation } from "./factories";

const now = new Date("2026-06-10T00:00:00.000Z");

describe("visibility", () => {
  it("published + verified is public and listable", () => {
    const o = makeRecord();
    expect(isPublic(o)).toBe(true);
    expect(isListable(o, now)).toBe(true);
  });
  it.each(["unverified", "rejected"] as const)("a non-demo %s record is never public", (status) => {
    expect(isPublic(makeRecord({ verificationStatus: status }))).toBe(false);
  });
  it.each(["draft", "in_review", "rejected", "unpublished", "archived"] as const)("a %s record is never public", (status) => {
    expect(isPublic(makeRecord({ publicationStatus: status }))).toBe(false);
  });
  it("demo records are public without verification (and are flagged, not verified)", () => {
    expect(isPublic(makeRecord({ isDemo: true, verificationStatus: "unverified" }))).toBe(true);
  });
  it("an expired record stays public (direct link) but is not listable", () => {
    const o = makeRecord({ applicationDeadline: "2026-06-01T00:00:00Z" });
    expect(isPublic(o)).toBe(true);
    expect(isListable(o, now)).toBe(false);
  });
  it("getEffectiveVerificationStatus turns verified+passed deadline into expired", () => {
    expect(getEffectiveVerificationStatus(makeRecord({ applicationDeadline: "2026-06-01T00:00:00Z" }), now)).toBe("expired");
    expect(getEffectiveVerificationStatus(makeRecord({ verificationStatus: "rejected" }), now)).toBe("rejected");
  });
});

describe("state machines", () => {
  it("verification", () => {
    expect(canTransitionVerification("unverified", "verified")).toBe(true);
    expect(canTransitionVerification("unverified", "expired")).toBe(false);
    expect(canTransitionVerification("rejected", "verified")).toBe(false); // must go through re-submission
    expect(canTransitionVerification("verified", "expired")).toBe(true);
  });
  it("publication", () => {
    expect(canTransitionPublication("draft", "published")).toBe(false); // must be reviewed first
    expect(canTransitionPublication("in_review", "published")).toBe(true);
    expect(canTransitionPublication("archived", "published")).toBe(false);
    // review outcomes: approve, reject; a rejected record can be fixed (draft) or resubmitted
    expect(canTransitionPublication("in_review", "rejected")).toBe(true);
    expect(canTransitionPublication("rejected", "published")).toBe(false);
    expect(canTransitionPublication("rejected", "in_review")).toBe(true);
    expect(canTransitionPublication("rejected", "draft")).toBe(true);
    expect(canTransitionPublication("published", "draft")).toBe(true); // unpublish
    expect(canTransitionPublication("published", "archived")).toBe(true);
    expect(canTransitionPublication("archived", "draft")).toBe(true);
  });
});

describe("getPublicationBlockers", () => {
  it("a fully valid verified record has no blockers", () => expect(canPublish(makeRecord(), now)).toBe(true));
  it("requires an official source", () => expect(getPublicationBlockers(makeRecord({ officialSourceUrl: null }), now)).toContain("missing_official_source"));
  it("requires https", () => expect(getPublicationBlockers(makeRecord({ officialSourceUrl: "http://x.example.com" }), now)).toContain("official_source_not_https"));
  it("requires verification with verifier and date (non-demo)", () => {
    expect(getPublicationBlockers(makeRecord({ verificationStatus: "unverified" }), now)).toContain("not_verified");
    expect(getPublicationBlockers(makeRecord({ verifiedBy: null }), now)).toContain("not_verified");
  });
  it("demo records are exempt from verification only", () => {
    const blockers = getPublicationBlockers(makeRecord({ isDemo: true, verificationStatus: "unverified", verifiedBy: null, lastVerifiedAt: null }), now);
    expect(blockers).toEqual([]);
  });
  it("requires an original-language translation with title and short description", () => {
    expect(getPublicationBlockers(makeRecord({ translations: [] }), now)).toContain("missing_original_translation");
    const noShort = makeTranslation({ language: "az", status: "original", translatedFrom: null, shortDescription: null });
    expect(getPublicationBlockers(makeRecord({ translations: [noShort] }), now)).toContain("missing_short_description");
  });
  it("a translation that is not the original does not satisfy the requirement", () => {
    const en = makeTranslation({ language: "en" });
    expect(getPublicationBlockers(makeRecord({ translations: [en] }), now)).toContain("missing_original_translation");
  });
  it("fixed deadline needs a date, and an expired record cannot be published", () => {
    expect(getPublicationBlockers(makeRecord({ applicationDeadline: null }), now)).toContain("deadline_required");
    expect(getPublicationBlockers(makeRecord({ applicationDeadline: "2026-06-01T00:00:00Z" }), now)).toContain("already_expired");
  });
});

describe("editing verified records", () => {
  it("changing a critical field returns the record to unverified", () => {
    const prev = makeRecord();
    const next = { ...prev, applicationDeadline: "2027-01-31T00:00:00Z" };
    expect(changedCriticalFields(prev, next)).toEqual(["applicationDeadline"]);
    expect(verificationAfterEdit(prev, next)).toBe("unverified");
  });
  it("changing a non-critical field keeps the verification", () => {
    const prev = makeRecord();
    expect(verificationAfterEdit(prev, { ...prev, featured: true })).toBe("verified");
  });
});
