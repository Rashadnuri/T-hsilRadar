import az from "@/messages/az.json";
import en from "@/messages/en.json";
import ru from "@/messages/ru.json";
import { locales } from "@/i18n/routing";
import { foldText } from "@/utils/fold-text";
import type { OpportunityFilters } from "@/validation/opportunity-filters";
import type { OpportunityRecord } from "@/types/opportunity";
import { CITIES, getCity } from "./cities";
import { compareByDeadline, daysUntilDeadline, getApplicationState, isAcceptingApplications } from "./deadline";
import { deriveMarketScope } from "./location";
import { getEffectiveVerificationStatus } from "./status";
import { isPublicTranslation } from "./translations";

/**
 * Catalogue search, filtering, sorting and facets — pure functions over records, so the same
 * logic is unit-tested here and later moves to SQL (the semantics stay identical).
 *
 * Rules worth knowing:
 *  - All filters combine with AND.
 *  - Expired opportunities NEVER appear as active: they are returned only when the visitor
 *    explicitly asks (deadline = expired, or verification = expired).
 *  - A filter on level / field / country matches only what the source STATES. "Not stated" is
 *    not treated as "open to everyone" (same principle as eligibility, DATA_MODEL.md §13).
 */

// ── Search ──────────────────────────────────────────────────────────────────────────────────

const MESSAGES = { az, ru, en } as const;

export interface SearchIndex {
  title: string;
  organization: string;
  /** Labels of type, fields, levels, funding, location type, city and country in ALL languages. */
  keywords: string;
  description: string;
}

/**
 * "Keywords" are derived, not hand-typed: everything a visitor might use to describe the
 * opportunity ("scholarship", "стипендия", "təqaüd", "ICT", "Baku", "Баку", "Germany").
 * Searching in any language therefore finds records in every language.
 */
function keywordsFor(o: OpportunityRecord): string {
  const parts: string[] = [];
  for (const locale of locales) {
    const m = MESSAGES[locale];
    parts.push(...o.categories.map((c) => m.opportunityTypes[c]), m.locationType[o.locationType], m.funding[o.fundingType]);
    parts.push(...o.educationLevels.map((l) => m.level[l]), ...o.eligibleFields.map((f) => m.fields[f]));
    const city = getCity(o.cityId)?.names[locale];
    if (city) parts.push(city);
    if (o.country) parts.push(new Intl.DisplayNames([locale], { type: "region" }).of(o.country) ?? o.country);
  }
  if (o.cityText) parts.push(o.cityText);
  if (o.otherTypeLabel) parts.push(o.otherTypeLabel);
  if (o.country) parts.push(o.country);
  return foldText(parts.join(" "));
}

export function getSearchIndex(o: OpportunityRecord): SearchIndex {
  // Only public translation rows are searchable: an unreviewed machine draft must not be findable.
  const rows = o.translations.filter(isPublicTranslation);
  return {
    title: foldText(rows.map((t) => t.title).join(" ")),
    organization: foldText(o.organization.name),
    keywords: keywordsFor(o),
    description: foldText(rows.map((t) => [t.shortDescription, t.description].filter(Boolean).join(" ")).join(" ")),
  };
}

export function tokenize(query: string | undefined): string[] {
  return query ? foldText(query).split(/\s+/).filter(Boolean) : [];
}

/** null = at least one search word is found nowhere; otherwise a weighted score (title > organization > keywords > description). */
export function relevanceScore(index: SearchIndex, tokens: readonly string[]): number | null {
  let score = 0;
  for (const token of tokens) {
    const s =
      (index.title.includes(token) ? 4 : 0) +
      (index.organization.includes(token) ? 3 : 0) +
      (index.keywords.includes(token) ? 2 : 0) +
      (index.description.includes(token) ? 1 : 0);
    if (s === 0) return null;
    score += s;
  }
  return score;
}

// ── Filtering ───────────────────────────────────────────────────────────────────────────────

export type FilterOmit = readonly (keyof OpportunityFilters)[];

/** Does `o` satisfy every active filter (except those in `omit`, used for facet counts)? */
export function matchesFilters(o: OpportunityRecord, f: OpportunityFilters, now: Date, omit: FilterOmit = []): boolean {
  const skip = (key: keyof OpportunityFilters) => omit.includes(key);
  const state = getApplicationState(o, now);

  // Expiry: expired records are shown only on explicit request.
  const wantsExpired = f.deadline === "expired" || f.verification === "expired";
  if (state === "expired" && !wantsExpired) return false;

  if (!skip("type") && f.type && !o.categories.includes(f.type)) return false;
  if (!skip("scope") && f.scope) {
    const scope = deriveMarketScope(o);
    if (scope !== f.scope && scope !== "both") return false;
  }
  if (!skip("country") && f.country && o.country !== f.country) return false;
  if (!skip("city") && f.city && o.cityId !== f.city) return false;
  if (!skip("level") && f.level && !o.educationLevels.includes(f.level)) return false;
  if (!skip("field") && f.field && !o.eligibleFields.includes(f.field)) return false;
  if (!skip("funding") && f.funding && o.fundingType !== f.funding) return false;
  if (!skip("location") && f.location && o.locationType !== f.location) return false;
  if (!skip("verification") && f.verification) {
    // "Expired" means the opportunity has ended (stored status or passed deadline), whatever its trust history.
    if (f.verification === "expired") {
      if (state !== "expired") return false;
    } else if (getEffectiveVerificationStatus(o, now) !== f.verification) return false;
  }

  if (!skip("deadline") && f.deadline) {
    switch (f.deadline) {
      case "open":
        if (!isAcceptingApplications(o, now)) return false;
        break;
      case "week":
      case "month": {
        const days = daysUntilDeadline(o, now);
        if (days === null || days < 0 || days > (f.deadline === "week" ? 7 : 30)) return false;
        break;
      }
      case "rolling":
        if (state !== "rolling") return false;
        break;
      case "expired":
        if (state !== "expired") return false;
        break;
    }
  }

  if (!skip("q")) {
    const tokens = tokenize(f.q);
    if (tokens.length && relevanceScore(getSearchIndex(o), tokens) === null) return false;
  }
  return true;
}

// ── Sorting ─────────────────────────────────────────────────────────────────────────────────

const ts = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);

/** Upcoming deadlines (soonest first) → no deadline → ended (most recently ended first). */
function compareApproachingDeadline(a: OpportunityRecord, b: OpportunityRecord, now: Date): number {
  const group = (o: OpportunityRecord) => (getApplicationState(o, now) === "expired" ? 2 : o.applicationDeadline && o.deadlineType === "fixed" ? 0 : 1);
  const ga = group(a), gb = group(b);
  if (ga !== gb) return ga - gb;
  if (ga === 2) return ts(b.applicationDeadline) - ts(a.applicationDeadline);
  return compareByDeadline(a, b);
}

export function sortRecords(items: OpportunityRecord[], sort: NonNullable<OpportunityFilters["sort"]>, query: string | undefined, now: Date): OpportunityRecord[] {
  const tokens = tokenize(query);
  const score = (o: OpportunityRecord) => relevanceScore(getSearchIndex(o), tokens) ?? 0;
  const published = (o: OpportunityRecord) => ts(o.publishedAt ?? o.createdAt);
  return [...items].sort((a, b) => {
    switch (sort) {
      case "relevance":
        return score(b) - score(a) || compareApproachingDeadline(a, b, now);
      case "newest":
        return published(b) - published(a);
      case "updated":
        return ts(b.updatedAt) - ts(a.updatedAt);
      case "deadline":
        return compareApproachingDeadline(a, b, now);
    }
  });
}

/** Default order: relevance when searching, otherwise deadline approaching. */
export const defaultSort = (query: string | undefined): NonNullable<OpportunityFilters["sort"]> =>
  tokenize(query).length ? "relevance" : "deadline";

// ── Facets ──────────────────────────────────────────────────────────────────────────────────

export interface Facets {
  /** Counts for the All / Azerbaijan / International tabs, honouring every OTHER active filter. */
  scope: { all: number; azerbaijan: number; international: number };
  /** Azerbaijani cities with their counts (other filters applied, scope/country/city ignored). */
  azerbaijaniCities: { id: string; count: number }[];
}

export function computeFacets(records: OpportunityRecord[], f: OpportunityFilters, now: Date): Facets {
  const forScope = records.filter((o) => matchesFilters(o, f, now, ["scope"]));
  const countScope = (scope: "azerbaijan" | "international") => forScope.filter((o) => { const s = deriveMarketScope(o); return s === scope || s === "both"; }).length;

  const forCity = records.filter((o) => matchesFilters(o, f, now, ["scope", "country", "city"]));
  const azerbaijaniCities = CITIES.filter((c) => c.country === "AZ")
    .map((c) => ({ id: c.id, count: forCity.filter((o) => o.cityId === c.id).length }))
    .filter((c) => c.count > 0);

  return { scope: { all: forScope.length, azerbaijan: countScope("azerbaijan"), international: countScope("international") }, azerbaijaniCities };
}

/** Options for the country and city selects: only places that actually have public records. */
export function getFilterOptions(records: OpportunityRecord[]) {
  const countries = [...new Set(records.flatMap((o) => (o.country ? [o.country] : [])))];
  const cityIds = [...new Set(records.flatMap((o) => (o.cityId ? [o.cityId] : [])))];
  const cities = cityIds.flatMap((id) => { const c = getCity(id); return c ? [{ id: c.id, country: c.country }] : []; });
  return { countries, cities };
}
