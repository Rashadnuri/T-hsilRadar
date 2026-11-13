import { describe, expect, it } from "vitest";
import {
  compareByDeadline, daysUntilDeadline, endOfDayInZone, getApplicationState, isAcceptingApplications, isDeadlinePassed, isExpired, isValidTimeZone, needsReverification,
} from "../deadline";
import { makeRecord } from "./factories";

const now = new Date("2026-06-10T12:00:00.000Z");
const withDeadline = (iso: string | null, extra = {}) =>
  makeRecord({ applicationDeadline: iso, deadlineType: iso ? "fixed" : "rolling", ...extra });

describe("getApplicationState", () => {
  it("open when the deadline is more than 7 days away", () => expect(getApplicationState(withDeadline("2026-07-01T00:00:00Z"), now)).toBe("open"));
  it("closing_soon within 7 days (inclusive)", () => expect(getApplicationState(withDeadline("2026-06-17T11:00:00Z"), now)).toBe("closing_soon"));
  it("expired once the deadline has passed", () => {
    expect(getApplicationState(withDeadline("2026-06-10T11:59:59Z"), now)).toBe("expired");
    expect(isDeadlinePassed(withDeadline("2026-06-10T11:59:59Z"), now)).toBe(true);
  });
  it("still open at the exact last instant before the deadline", () => expect(getApplicationState(withDeadline("2026-06-10T12:00:00.001Z"), now)).toBe("closing_soon"));
  it("rolling has no deadline and is accepting applications", () => {
    const o = withDeadline(null);
    expect(getApplicationState(o, now)).toBe("rolling");
    expect(isAcceptingApplications(o, now)).toBe(true);
  });
  it("unknown deadline is neither open nor expired", () => {
    const o = makeRecord({ deadlineType: "unknown", applicationDeadline: null });
    expect(getApplicationState(o, now)).toBe("deadline_unknown");
    expect(isAcceptingApplications(o, now)).toBe(false);
  });
  it("upcoming before the start date", () => expect(getApplicationState(withDeadline("2026-09-01T00:00:00Z", { applicationStartDate: "2026-07-01T00:00:00Z" }), now)).toBe("upcoming"));
  it("a stored 'expired' verification wins even if the deadline looks open (stale data can only be MORE expired)", () => {
    expect(isExpired(withDeadline("2026-12-01T00:00:00Z", { verificationStatus: "expired" }), now)).toBe(true);
  });
  it("a passed deadline wins even if the stored status was never updated by the cron", () => {
    expect(isExpired(withDeadline("2026-06-01T00:00:00Z", { verificationStatus: "verified" }), now)).toBe(true);
  });
});

describe("daysUntilDeadline", () => {
  it("rounds up partial days", () => expect(daysUntilDeadline(withDeadline("2026-06-10T13:00:00Z"), now)).toBe(1));
  it("is negative after the deadline", () => expect(daysUntilDeadline(withDeadline("2026-06-08T12:00:00Z"), now)).toBe(-2));
  it("is null without a fixed deadline", () => expect(daysUntilDeadline(withDeadline(null), now)).toBeNull());
});

describe("compareByDeadline", () => {
  it("sorts soonest first and no-deadline last", () => {
    const a = withDeadline("2026-08-01T00:00:00Z"), b = withDeadline("2026-07-01T00:00:00Z"), c = withDeadline(null);
    expect([a, c, b].sort(compareByDeadline)).toEqual([b, a, c]);
  });
});

describe("needsReverification", () => {
  it("true when the last check is older than the window", () => expect(needsReverification({ verificationStatus: "verified", lastVerifiedAt: "2026-01-01T00:00:00Z" }, now, 90)).toBe(true));
  it("false when recent", () => expect(needsReverification({ verificationStatus: "verified", lastVerifiedAt: "2026-06-01T00:00:00Z" }, now, 90)).toBe(false));
  it("false when not verified (nothing to re-verify)", () => expect(needsReverification({ verificationStatus: "unverified", lastVerifiedAt: null }, now)).toBe(false));
});

describe("endOfDayInZone", () => {
  it("Baku (UTC+4, no DST): end of 1 March is 19:59:59.999Z", () => expect(endOfDayInZone("2027-03-01", "Asia/Baku")).toBe("2027-03-01T19:59:59.999Z"));
  it("New York in winter (UTC-5)", () => expect(endOfDayInZone("2027-01-15", "America/New_York")).toBe("2027-01-16T04:59:59.999Z"));
  it("New York on the DST switch day (UTC-4 at the end of the day)", () => expect(endOfDayInZone("2027-03-14", "America/New_York")).toBe("2027-03-15T03:59:59.999Z"));
  it("UTC is the identity", () => expect(endOfDayInZone("2027-03-01", "UTC")).toBe("2027-03-01T23:59:59.999Z"));
  it("rejects malformed dates", () => expect(() => endOfDayInZone("01/03/2027")).toThrow(RangeError));
  it("validates time zones", () => {
    expect(isValidTimeZone("Asia/Baku")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
