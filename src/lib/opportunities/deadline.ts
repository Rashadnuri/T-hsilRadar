import type { Opportunity } from "@/types/opportunity";

/**
 * Deadline and expiration logic. Temporal state is DERIVED from timestamps and `now` on every
 * call; a stored flag can only ever make an opportunity "more expired", never less, so a stale
 * cache cannot present an ended opportunity as open (ARCHITECTURE.md §4).
 */

export const DAY_MS = 86_400_000;
export const CLOSING_SOON_DAYS = 7;
export const DEFAULT_TIMEZONE = "Asia/Baku";

export type ApplicationState = "upcoming" | "open" | "closing_soon" | "rolling" | "deadline_unknown" | "expired";

type TimeFields = Pick<Opportunity, "applicationStartDate" | "applicationDeadline" | "deadlineType" | "verificationStatus">;

const ms = (iso: string) => new Date(iso).getTime();

export function isDeadlinePassed(o: Pick<Opportunity, "applicationDeadline" | "deadlineType">, now = new Date()): boolean {
  return o.deadlineType === "fixed" && o.applicationDeadline !== null && ms(o.applicationDeadline) < now.getTime();
}

/** Whole days left, rounded up (a deadline later today is 1). Negative once passed; null without a fixed deadline. */
export function daysUntilDeadline(o: Pick<Opportunity, "applicationDeadline" | "deadlineType">, now = new Date()): number | null {
  if (o.deadlineType !== "fixed" || o.applicationDeadline === null) return null;
  return Math.ceil((ms(o.applicationDeadline) - now.getTime()) / DAY_MS);
}

export function getApplicationState(o: TimeFields, now = new Date()): ApplicationState {
  if (o.verificationStatus === "expired" || isDeadlinePassed(o, now)) return "expired";
  if (o.applicationStartDate !== null && ms(o.applicationStartDate) > now.getTime()) return "upcoming";
  if (o.deadlineType === "rolling") return "rolling";
  if (o.deadlineType === "unknown" || o.applicationDeadline === null) return "deadline_unknown";
  const days = daysUntilDeadline(o, now) ?? Infinity;
  return days <= CLOSING_SOON_DAYS ? "closing_soon" : "open";
}

export const isExpired = (o: TimeFields, now = new Date()) => getApplicationState(o, now) === "expired";

/** True when a person can apply right now as far as we know (excludes upcoming, expired and unknown). */
export function isAcceptingApplications(o: TimeFields, now = new Date()): boolean {
  const state = getApplicationState(o, now);
  return state === "open" || state === "closing_soon" || state === "rolling";
}

/** Soonest deadline first; rolling/unknown/no-deadline last. Stable for equal deadlines. */
export function compareByDeadline(
  a: Pick<Opportunity, "applicationDeadline">,
  b: Pick<Opportunity, "applicationDeadline">,
): number {
  const da = a.applicationDeadline ? ms(a.applicationDeadline) : Infinity;
  const db = b.applicationDeadline ? ms(b.applicationDeadline) : Infinity;
  return da === db ? 0 : da < db ? -1 : 1;
}

/**
 * A verified opportunity whose last check is older than `windowDays` should be re-checked
 * (SECURITY.md §5). This is a derived flag, not a verification status.
 */
export function needsReverification(
  o: Pick<Opportunity, "verificationStatus" | "lastVerifiedAt">,
  now = new Date(),
  windowDays = 90,
): boolean {
  if (o.verificationStatus !== "verified") return false;
  return o.lastVerifiedAt === null || now.getTime() - ms(o.lastVerifiedAt) > windowDays * DAY_MS;
}

// ── Time zones ──────────────────────────────────────────────────────────────────────────────

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Sources usually say "apply by 30 April" without a time. Convention: that means the END of
 * that calendar day in the organization's time zone. Returns the matching UTC instant (ISO).
 */
export function endOfDayInZone(date: string, timeZone: string = DEFAULT_TIMEZONE): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`Expected YYYY-MM-DD, got "${date}"`);
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const localEnd = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  // Two passes handle daylight-saving transitions near the target instant.
  let instant = localEnd - zoneOffsetMs(localEnd, timeZone);
  instant = localEnd - zoneOffsetMs(instant, timeZone);
  return new Date(instant).toISOString();
}

/**
 * A wall-clock time typed in a form ("2027-03-01T18:30", no zone) means that time in `timeZone`
 * (the organization's own zone, default Asia/Baku). Returns the matching UTC instant (ISO), or
 * null when the text is not a valid date-time.
 */
export function zonedLocalToUtc(local: string, timeZone: string = DEFAULT_TIMEZONE): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!match || !isValidTimeZone(timeZone)) return null;
  const [y, mo, d, h, mi, sec] = [match[1], match[2], match[3], match[4], match[5], match[6] ?? "0"].map(Number) as [number, number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, sec);
  const check = new Date(asUtc);
  // Reject impossible dates such as 2027-02-31 (Date.UTC would roll over).
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
  let instant = asUtc - zoneOffsetMs(asUtc, timeZone);
  instant = asUtc - zoneOffsetMs(instant, timeZone);
  return new Date(instant).toISOString();
}

/** The inverse, for editing: a UTC instant shown as "YYYY-MM-DDTHH:mm" in `timeZone`. */
export function utcToZonedLocal(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
