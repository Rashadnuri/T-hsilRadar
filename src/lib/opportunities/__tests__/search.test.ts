import { describe, expect, it } from "vitest";
import { parseOpportunityFilters, type OpportunityFilters } from "@/validation/opportunity-filters";
import type { OpportunityRecord } from "@/types/opportunity";
import { computeFacets, defaultSort, getFilterOptions, matchesFilters, relevanceScore, getSearchIndex, sortRecords, tokenize } from "../search";
import { makeRecord, makeTranslation, ORG } from "./factories";

const now = new Date("2026-06-10T12:00:00.000Z");
const day = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();
const f = (raw: Record<string, string> = {}): OpportunityFilters => parseOpportunityFilters(raw);
const ids = (list: OpportunityRecord[]) => list.map((o) => o.id).sort();
const pick = (records: OpportunityRecord[], raw: Record<string, string>) => ids(records.filter((o) => matchesFilters(o, f(raw), now)));

const az = (title: string, extra = {}) => makeTranslation({ language: "az", status: "original", translatedFrom: null, title, shortDescription: "Qısa", ...extra });

/** A small, varied catalogue. */
const baku = makeRecord({ id: "a", slug: "a", opportunityType: "scholarship", country: "AZ", cityId: "baku", educationLevels: ["bachelor", "master"], eligibleFields: ["ict"],
  fundingType: "fully_funded", locationType: "onsite", applicationDeadline: day(20), publishedAt: day(-10), updatedAt: day(-1), translations: [az("Alfa", { description: "Unikal-tərif sözü" })] });
const ganja = makeRecord({ id: "b", slug: "b", opportunityType: "internship", country: "AZ", cityId: "ganja", educationLevels: ["bachelor"], eligibleFields: ["engineering"],
  fundingType: "paid", locationType: "hybrid", applicationDeadline: day(5), publishedAt: day(-3), updatedAt: day(-8), translations: [az("Beta")] });
const berlin = makeRecord({ id: "c", slug: "c", opportunityType: "exchange", country: "DE", cityId: "berlin", educationLevels: ["master"], eligibleFields: [],
  fundingType: "partially_funded", locationType: "onsite", applicationDeadline: day(60), publishedAt: day(-1), updatedAt: day(-30), translations: [az("Gamma")] });
const remote = makeRecord({ id: "d", slug: "d", opportunityType: "training", country: null, cityId: null, educationLevels: [], eligibleFields: ["ict", "business_law"],
  fundingType: "unpaid", locationType: "remote", deadlineType: "rolling", applicationDeadline: null, publishedAt: day(-20), updatedAt: day(-2), translations: [az("Delta")] });
const ended = makeRecord({ id: "e", slug: "e", opportunityType: "scholarship", country: "AZ", cityId: "baku", educationLevels: ["bachelor"], fundingType: "fully_funded",
  applicationDeadline: day(-3), publishedAt: day(-40), updatedAt: day(-3), translations: [az("Epsilon")] });
const demoUnverified = makeRecord({ id: "f", slug: "f", opportunityType: "competition", isDemo: true, verificationStatus: "unverified", verifiedBy: null, lastVerifiedAt: null, country: "TR", cityId: "istanbul",
  applicationDeadline: day(3), publishedAt: day(-5), updatedAt: day(-5), translations: [az("Zeta")] });
const all = [baku, ganja, berlin, remote, ended, demoUnverified];

describe("expiry in the catalogue", () => {
  it("never lists expired opportunities as active (default view)", () => expect(pick(all, {})).toEqual(["a", "b", "c", "d", "f"]));
  it("shows them only when asked: deadline=expired", () => expect(pick(all, { deadline: "expired" })).toEqual(["e"]));
  it("…or verification=expired (effective status: passed deadline counts)", () => expect(pick(all, { verification: "expired" })).toEqual(["e"]));
  it("an expired record never matches 'open' or 'week'", () => {
    expect(pick(all, { deadline: "open" })).not.toContain("e");
    expect(pick(all, { deadline: "week" })).not.toContain("e");
  });
  it("verification=expired means 'ended': it also matches an unverified record whose deadline passed (e.g. demo data)", () => {
    const unverifiedEnded = makeRecord({ id: "u", verificationStatus: "unverified", verifiedBy: null, lastVerifiedAt: null, isDemo: true, applicationDeadline: day(-4), translations: [az("U")] });
    expect(pick([unverifiedEnded], { verification: "expired" })).toEqual(["u"]);
    expect(pick([unverifiedEnded], { verification: "unverified" })).toEqual([]); // ended records are hidden unless asked for
    expect(pick([unverifiedEnded], { verification: "unverified", deadline: "expired" })).toEqual(["u"]);
  });
  it("a stored 'expired' status hides a record even if the deadline looks open", () => {
    const stale = makeRecord({ id: "g", verificationStatus: "expired", applicationDeadline: day(40), translations: [az("Stale")] });
    expect(pick([stale], {})).toEqual([]);
    expect(pick([stale], { verification: "expired" })).toEqual(["g"]);
  });
});

describe("filters (each, then together)", () => {
  it("type", () => expect(pick(all, { type: "internship" })).toEqual(["b"]));
  it("country (case-insensitive in the URL)", () => {
    expect(pick(all, { country: "DE" })).toEqual(["c"]);
    expect(pick(all, { country: "de" })).toEqual(["c"]);
  });
  it("city", () => expect(pick(all, { city: "ganja" })).toEqual(["b"]));
  it("education level matches only stated levels", () => {
    expect(pick(all, { level: "master" })).toEqual(["a", "c"]);
    expect(pick(all, { level: "bachelor" })).toEqual(["a", "b", "f"]);
  });
  it("academic field matches only stated fields ('not restricted' is not 'open to all')", () => {
    expect(pick(all, { field: "ict" })).toEqual(["a", "d"]);
    expect(pick(all, { field: "engineering" })).toEqual(["b"]);
    expect(pick(all, { field: "health" })).toEqual([]);
  });
  it("funding type", () => {
    expect(pick(all, { funding: "fully_funded" })).toEqual(["a", "f"]); // f: demo fixture defaults to fully_funded
    expect(pick(all, { funding: "unpaid" })).toEqual(["d"]);
    expect(pick(all, { funding: "partially_funded" })).toEqual(["c"]);
  });
  it("location type: remote / onsite / hybrid", () => {
    expect(pick(all, { location: "remote" })).toEqual(["d"]);
    expect(pick(all, { location: "hybrid" })).toEqual(["b"]);
    expect(pick(all, { location: "onsite" })).toEqual(["a", "c", "f"]);
  });
  it("deadline: open / week / month / rolling", () => {
    expect(pick(all, { deadline: "open" })).toEqual(["a", "b", "c", "d", "f"]); // rolling counts as accepting
    expect(pick(all, { deadline: "week" })).toEqual(["b", "f"]);
    expect(pick(all, { deadline: "month" })).toEqual(["a", "b", "f"]);
    expect(pick(all, { deadline: "rolling" })).toEqual(["d"]);
  });
  it("verification: verified / unverified", () => {
    expect(pick(all, { verification: "verified" })).toEqual(["a", "b", "c", "d"]);
    expect(pick(all, { verification: "unverified" })).toEqual(["f"]);
  });
  it("scope: Azerbaijan = hosted in AZ + remote open to AZ; International = hosted abroad + remote open abroad", () => {
    expect(pick(all, { scope: "azerbaijan" })).toEqual(["a", "b", "d"]);
    expect(pick(all, { scope: "international" })).toEqual(["c", "d", "f"]);
  });
  it("filters combine with AND", () => {
    expect(pick(all, { scope: "azerbaijan", type: "scholarship" })).toEqual(["a"]);
    expect(pick(all, { scope: "azerbaijan", type: "internship", city: "ganja", level: "bachelor", field: "engineering", funding: "paid", location: "hybrid", deadline: "week", verification: "verified" })).toEqual(["b"]);
    expect(pick(all, { country: "AZ", level: "master" })).toEqual(["a"]);
    expect(pick(all, { type: "scholarship", city: "ganja" })).toEqual([]);
  });
  it("ignores invalid / legacy / empty parameters instead of failing", () => {
    expect(pick(all, { type: "course", funding: "free", country: "Germany", city: "Not A Slug!", deadline: "soon", sort: "random", page: "-3" })).toEqual(["a", "b", "c", "d", "f"]);
  });
});

describe("search", () => {
  const sIds = (q: string) => pick(all, { q });
  it("matches the opportunity title", () => expect(sIds("Beta")).toEqual(["b"]));
  it("matches the organization name", () => expect(pick([makeRecord({ id: "o", organization: { ...ORG, name: "Qafqaz Foundation" }, translations: [az("X")] })], { q: "qafqaz" })).toEqual(["o"]));
  it("matches the full description", () => expect(sIds("unikal-tərif")).toEqual(["a"]));
  it("matches keywords in any language: type, place, field", () => {
    expect(sIds("scholarship")).toEqual(["a"]); // English label, Azerbaijani-only text
    expect(sIds("стипендии")).toEqual(["a"]); // Russian label
    expect(sIds("təqaüdlər")).toEqual(["a"]);
    expect(sIds("Баку")).toEqual(["a"]);
    expect(sIds("Germany")).toEqual(["c"]);
    expect(sIds("hybrid")).toEqual(["b"]);
  });
  it("folds diacritics and case (ə→e, ı→i, ö→o …)", () => {
    expect(sIds("TƏQAÜDLƏR")).toEqual(["a"]);
    expect(sIds("teqaudler")).toEqual(["a"]);
    expect(sIds("gence")).toEqual(["b"]);
  });
  it("requires every word (AND) and finds nothing for gibberish", () => {
    expect(sIds("beta ganja")).toEqual(["b"]);
    expect(sIds("beta baku")).toEqual([]);
    expect(sIds("zzzqqq")).toEqual([]);
  });
  it("does not search unreviewed machine drafts", () => {
    const withDraft = makeRecord({ id: "m", translations: [az("Normal"), makeTranslation({ language: "ru", status: "machine_draft", title: "Секретный-черновик", shortDescription: null })] });
    expect(pick([withDraft], { q: "секретный-черновик" })).toEqual([]);
  });
  it("search combines with filters", () => {
    expect(pick(all, { q: "baku", type: "scholarship" })).toEqual(["a"]);
    expect(pick(all, { q: "baku", type: "internship" })).toEqual([]);
  });
  it("weights title above organization above keywords above description", () => {
    const idx = (o: Partial<OpportunityRecord>) => getSearchIndex(makeRecord({ translations: [az("Zzz")], ...o }));
    const t = tokenize("alpha");
    const inTitle = relevanceScore({ ...idx({}), title: "alpha" }, t)!;
    const inOrg = relevanceScore({ ...idx({}), organization: "alpha" }, t)!;
    const inKeywords = relevanceScore({ ...idx({}), keywords: "alpha" }, t)!;
    const inDescription = relevanceScore({ ...idx({}), description: "alpha" }, t)!;
    expect(inTitle).toBeGreaterThan(inOrg);
    expect(inOrg).toBeGreaterThan(inKeywords);
    expect(inKeywords).toBeGreaterThan(inDescription);
  });
});

describe("sorting", () => {
  const order = (sort: NonNullable<OpportunityFilters["sort"]>, records = all, q?: string) =>
    sortRecords(records.filter((o) => matchesFilters(o, f(q ? { q } : {}), now)), sort, q, now).map((o) => o.id);
  it("newest = most recently published first", () => expect(order("newest")).toEqual(["c", "b", "f", "a", "d"]));
  it("recently updated = most recently edited first", () => expect(order("updated")).toEqual(["a", "d", "f", "b", "c"]));
  it("deadline approaching = soonest first, rolling last", () => expect(order("deadline")).toEqual(["f", "b", "a", "c", "d"]));
  it("deadline sort puts ended opportunities last, most recently ended first", () => {
    const ended2 = makeRecord({ id: "h", applicationDeadline: day(-20), translations: [az("Old")] });
    const sorted = sortRecords([ended2, ended, baku, remote], "deadline", undefined, now).map((o) => o.id);
    expect(sorted).toEqual(["a", "d", "e", "h"]);
  });
  it("relevance: title match beats keyword-only match", () => {
    const r1 = makeRecord({ id: "r1", opportunityType: "scholarship", translations: [az("Grants fund")] });
    const r2 = makeRecord({ id: "r2", opportunityType: "scholarship", translations: [az("Scholarship in title")] });
    expect(sortRecords([r1, r2], "relevance", "scholarship", now).map((o) => o.id)).toEqual(["r2", "r1"]);
  });
  it("default sort: relevance when searching, otherwise deadline approaching", () => {
    expect(defaultSort("baku")).toBe("relevance");
    expect(defaultSort(undefined)).toBe("deadline");
    expect(defaultSort("   ")).toBe("deadline");
  });
});

describe("facets and options", () => {
  it("scope tab counts honour every other filter", () => {
    expect(computeFacets(all, f(), now).scope).toEqual({ all: 5, azerbaijan: 3, international: 3 });
    expect(computeFacets(all, f({ type: "scholarship" }), now).scope).toEqual({ all: 1, azerbaijan: 1, international: 0 });
    // the active scope itself must not reduce its own tab counts
    expect(computeFacets(all, f({ scope: "azerbaijan" }), now).scope).toEqual({ all: 5, azerbaijan: 3, international: 3 });
  });
  it("Azerbaijani city counts ignore scope/country/city but honour the rest", () => {
    expect(computeFacets(all, f(), now).azerbaijaniCities).toEqual(expect.arrayContaining([{ id: "baku", count: 1 }, { id: "ganja", count: 1 }]));
    expect(computeFacets(all, f({ type: "internship" }), now).azerbaijaniCities).toEqual([{ id: "ganja", count: 1 }]);
  });
  it("filter options list only places that have records", () => {
    const o = getFilterOptions(all);
    expect(o.countries.sort()).toEqual(["AZ", "DE", "TR"]);
    expect(o.cities.map((c) => c.id).sort()).toEqual(["baku", "berlin", "ganja", "istanbul"]);
  });
});
