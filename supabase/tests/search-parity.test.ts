import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoUuid } from "@/db/demo-seed";
import { getDemoRecords } from "@/features/opportunities/demo-data";
import { computeFacets, defaultSort, getFilterOptions, getSearchIndex, matchesFilters, relevanceScore, sortRecords, tokenize } from "@/lib/opportunities/search";
import { buildSearchFilters } from "@/repositories/supabase/search-params";
import type { OpportunityRecord } from "@/types/opportunity";
import { DEADLINE_FILTERS, EDUCATION_LEVELS, FIELDS_OF_STUDY, FUNDING_TYPES, LOCATION_TYPES, OPPORTUNITY_TYPES, SORT_OPTIONS, VERIFICATION_STATUSES } from "@/types/opportunity";
import { parseOpportunityFilters, type OpportunityFilters } from "@/validation/opportunity-filters";
import { databaseAvailable, first, TestDb } from "./helpers";

/**
 * The catalogue semantics exist twice: as tested TypeScript (lib/opportunities/search.ts, used by
 * the demo repository) and as SQL (migration 6, used with Supabase). This suite runs hundreds
 * of generated cases against BOTH, on the same data, and requires identical answers.
 */
const available = await databaseAvailable();

describe.skipIf(!available)("SQL search ≡ TypeScript search", () => {
  const records: OpportunityRecord[] = getDemoRecords();
  const t0 = Date.now();
  const now = new Date(t0 + 2000);
  let db: TestDb;
  const idOf = new Map(records.map((r) => [demoUuid(r.id), r.id] as const));

  beforeAll(async () => { db = await TestDb.create({ seed: true, nowMs: t0, records }); });
  afterAll(async () => { await db?.drop(); });

  const f = (raw: Record<string, string>) => parseOpportunityFilters(raw);

  const tsIds = (filters: OpportunityFilters, pool = records) => {
    const matched = pool.filter((o) => matchesFilters(o, filters, now));
    return sortRecords(matched, filters.sort ?? defaultSort(filters.q), filters.q, now).map((o) => o.id);
  };
  const sqlIds = async (filters: OpportunityFilters, extras = {}) => {
    const rows = await db.sql<{ id: string }>("select id from public.search_opportunities($1::jsonb, 1, 100, $2::timestamptz)", [JSON.stringify(buildSearchFilters(filters, extras)), now.toISOString()]);
    return rows.map((r) => idOf.get(r.id)!);
  };
  const sameSet = (a: string[], b: string[]) => expect([...a].sort()).toEqual([...b].sort());

  // ── deterministic pseudo-random combinations ────────────────────────────────────────────
  const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = <T,>(r: () => number, list: readonly T[]) => list[Math.floor(r() * list.length)]!;
  const QUERIES = ["scholarship", "təqaüdlər", "стипендии", "Баку", "Mingachevir", "Мингечевир", "Germany", "Германия", "Almaniya", "hybrid", "communication technologies",
    "gence", "TƏQAÜD", "bank trainee", "bank hackathon", "zzzqqq", "fictional sample internship", "Demo Bank", "digital", "youth leadership", "internship", "de", "ö", "ё",
    "Gəncə", "Şəki", "shaki", "nakhchivan", "стажировка", "программа", "Ganja IT", "free", "paid", "unpaid", "ICT", "a", "e", "demo", "Deutsch", "tr", "Istanbul", "AZ"];

  it("catalogue queries stay fast with default server settings (guards against JIT-compilation regressions)", async () => {
    const filters = JSON.stringify(buildSearchFilters(f({ q: "internship", scope: "azerbaijan" })));
    const started = performance.now();
    for (let i = 0; i < 10; i++) {
      await db.sql("select * from public.search_opportunities($1::jsonb, 1, 6, $2::timestamptz)", [filters, now.toISOString()]);
      await db.sql("select public.catalogue_facets($1::jsonb, $2::timestamptz)", [filters, now.toISOString()]);
    }
    // Measured: ~5 ms per call; with JIT enabled it was ~1900 ms per call.
    expect((performance.now() - started) / 20).toBeLessThan(250);
  }, 15_000);

  it("every single filter value returns the same records", async () => {
    const cases: Record<string, string>[] = [{}];
    for (const type of OPPORTUNITY_TYPES) cases.push({ type });
    for (const scope of ["azerbaijan", "international"]) cases.push({ scope });
    for (const country of ["AZ", "DE", "CH", "GB", "TR", "NL", "US", "FR", "az"]) cases.push({ country });
    for (const city of ["baku", "sumgait", "ganja", "mingachevir", "shaki", "nakhchivan", "berlin", "boston", "lankaran"]) cases.push({ city });
    for (const level of EDUCATION_LEVELS) cases.push({ level });
    for (const field of FIELDS_OF_STUDY) cases.push({ field });
    for (const funding of FUNDING_TYPES) cases.push({ funding });
    for (const location of LOCATION_TYPES) cases.push({ location });
    for (const deadline of DEADLINE_FILTERS) cases.push({ deadline });
    for (const verification of VERIFICATION_STATUSES) cases.push({ verification });
    expect(cases.length).toBeGreaterThan(60);
    for (const raw of cases) {
      const filters = f(raw);
      sameSet(await sqlIds(filters), tsIds(filters));
    }
  });

  it("300 random filter combinations return the same records", async () => {
    const r = rng(20260301);
    let nonEmpty = 0;
    for (let i = 0; i < 300; i++) {
      const raw: Record<string, string> = {};
      if (r() < 0.3) raw.type = pick(r, OPPORTUNITY_TYPES);
      if (r() < 0.25) raw.scope = pick(r, ["azerbaijan", "international"]);
      if (r() < 0.2) raw.country = pick(r, ["AZ", "DE", "GB", "TR", "US"]);
      if (r() < 0.2) raw.city = pick(r, ["baku", "ganja", "berlin", "sumgait"]);
      if (r() < 0.25) raw.level = pick(r, EDUCATION_LEVELS);
      if (r() < 0.25) raw.field = pick(r, FIELDS_OF_STUDY);
      if (r() < 0.25) raw.funding = pick(r, FUNDING_TYPES);
      if (r() < 0.25) raw.location = pick(r, LOCATION_TYPES);
      if (r() < 0.25) raw.deadline = pick(r, DEADLINE_FILTERS);
      if (r() < 0.15) raw.verification = pick(r, VERIFICATION_STATUSES);
      if (r() < 0.3) raw.q = pick(r, QUERIES);
      raw.sort = pick(r, [...SORT_OPTIONS, ""]);
      const filters = f(raw);
      const sql = await sqlIds(filters), ts = tsIds(filters);
      sameSet(sql, ts);
      if (ts.length) nonEmpty++;
    }
    expect(nonEmpty).toBeGreaterThan(60); // the generator actually exercises non-trivial results
  });

  it("every search query (all languages, diacritics, descriptions, keywords) matches the same records with the same relevance", async () => {
    for (const q of QUERIES) {
      const filters = f({ q });
      const tokens = tokenize(q);
      sameSet(await sqlIds(filters), tsIds(filters));
      // identical scores per record
      const rows = await db.sql<{ id: string; relevance: number }>("select id, relevance from public.opportunity_search_rows($1::jsonb, $2::timestamptz) where ok_q and ok_expiry", [JSON.stringify(buildSearchFilters(filters)), now.toISOString()]);
      for (const row of rows) {
        const record = records.find((o) => o.id === idOf.get(row.id))!;
        expect(row.relevance, `${q} → ${record.slug}`).toBe(relevanceScore(getSearchIndex(record), tokens) ?? 0);
      }
    }
  });

  it("sorting produces the same order (ties may differ only between records with identical sort keys)", async () => {
    const key = (o: OpportunityRecord, sort: string, q?: string) => {
      switch (sort) {
        case "newest": return [Date.parse(o.publishedAt ?? o.createdAt)];
        case "updated": return [Date.parse(o.updatedAt)];
        case "relevance": return [relevanceScore(getSearchIndex(o), tokenize(q)) ?? 0, o.applicationDeadline ? Date.parse(o.applicationDeadline) : Infinity];
        default: return [o.applicationDeadline ? Date.parse(o.applicationDeadline) : Infinity];
      }
    };
    for (const sort of ["deadline", "newest", "updated", "relevance"]) {
      const bases: { q?: string; deadline?: string; scope?: string; type?: string }[] = [{}, { q: "internship" }, { q: "demo" }, { deadline: "expired" }, { scope: "azerbaijan" }, { type: "scholarship" }];
      for (const base of bases) {
        const filters = f({ ...base, sort });
        const sql = await sqlIds(filters), ts = tsIds(filters);
        sameSet(sql, ts);
        // positions may differ only where the keys are equal
        sql.forEach((id, i) => {
          if (id === ts[i]) return;
          const a = records.find((o) => o.id === id)!, b = records.find((o) => o.id === ts[i])!;
          expect(key(a, sort, base.q), `${sort} ${JSON.stringify(base)} pos ${i}`).toEqual(key(b, sort, base.q));
        });
      }
    }
  });

  it("deadline order: approaching first, then no deadline, then ended (most recently ended first)", async () => {
    const ids = await sqlIds(f({ deadline: "" }));
    const first = records.find((o) => o.id === ids[0])!;
    expect(first.slug).toBe("demo-hackathon-weekend"); // 5 days left
    const withExpired = await sqlIds(f({ verification: "expired", sort: "deadline" }));
    const ended = withExpired.map((id) => records.find((o) => o.id === id)!).map((o) => o.slug);
    expect(ended).toEqual(["demo-expired-internship", "demo-expired-scholarship"].sort((a, b) => records.find((o) => o.slug === b)!.applicationDeadline!.localeCompare(records.find((o) => o.slug === a)!.applicationDeadline!)).reverse().reverse());
  });

  it("facets (Azerbaijan/International tabs and Azerbaijani city counts) match", async () => {
    const r = rng(7);
    const cases: Record<string, string>[] = [{}, { scope: "azerbaijan" }, { type: "internship" }, { q: "baku" }, { deadline: "expired" }, { level: "bachelor", funding: "paid" }];
    for (let i = 0; i < 40; i++) {
      const raw: Record<string, string> = {};
      if (r() < 0.4) raw.type = pick(r, OPPORTUNITY_TYPES);
      if (r() < 0.3) raw.scope = pick(r, ["azerbaijan", "international"]);
      if (r() < 0.3) raw.level = pick(r, EDUCATION_LEVELS);
      if (r() < 0.3) raw.funding = pick(r, FUNDING_TYPES);
      if (r() < 0.3) raw.q = pick(r, QUERIES);
      if (r() < 0.2) raw.country = pick(r, ["AZ", "DE"]);
      if (r() < 0.2) raw.city = pick(r, ["baku", "ganja"]);
      cases.push(raw);
    }
    for (const raw of cases) {
      const filters = f(raw);
      const { facets } = first(await db.sql<{ facets: unknown }>("select public.catalogue_facets($1::jsonb, $2::timestamptz) as facets", [JSON.stringify(buildSearchFilters(filters)), now.toISOString()]));
      expect(facets, JSON.stringify(raw)).toEqual(computeFacets(records, filters, now));
    }
  });

  it("filter options (countries and cities with public records) match", async () => {
    const { options } = first(await db.sql<{ options: { countries: string[]; cities: { id: string; country: string }[] } }>("select public.catalogue_filter_options() as options"));
    const ts = getFilterOptions(records);
    expect([...options.countries].sort()).toEqual([...ts.countries].sort());
    expect(options.cities.map((c) => c.id).sort()).toEqual(ts.cities.map((c) => c.id).sort());
    const { noDemo } = first(await db.sql<{ noDemo: { countries: string[] } }>("select public.catalogue_filter_options(true) as \"noDemo\""));
    expect(noDemo.countries).toEqual([]); // every seeded record is demo
  });

  it("the type filter matches ANY category of a multi-category opportunity, in SQL and TypeScript alike", async () => {
    await db.tx(null, async (q) => {
      const research = records.find((r) => r.slug === "demo-research-fellowship")!;
      await q("insert into public.opportunity_categories (opportunity_id, category_code) values ($1, 'scholarship')", [demoUuid(research.id)]);
      const multi = records.map((r) => (r === research ? { ...r, categories: [r.opportunityType, "scholarship" as const] } : r));
      const filters = f({ type: "scholarship" });
      const rows = await q<{ id: string }>("select id from public.search_opportunities($1::jsonb, 1, 100, $2::timestamptz)", [JSON.stringify(buildSearchFilters(filters)), now.toISOString()]);
      const sql = rows.map((r) => idOf.get(r.id)!);
      sameSet(sql, tsIds(filters, multi));
      expect(sql).toContain(research.id);
      // keyword search sees the extra category's label too
      const kw = f({ q: "scholarships" });
      const kwRows = await q<{ id: string }>("select id from public.search_opportunities($1::jsonb, 1, 100, $2::timestamptz)", [JSON.stringify(buildSearchFilters(kw)), now.toISOString()]);
      sameSet(kwRows.map((r) => idOf.get(r.id)!), tsIds(kw, multi));
    });
  });

  it("paging: stable, complete, clamps out-of-range pages, caps the page size", async () => {
    const filters = JSON.stringify(buildSearchFilters(f({})));
    const page = (p: number, size: number) => db.sql<{ id: string; total_count: number; page: number }>("select * from public.search_opportunities($1::jsonb, $2, $3, $4::timestamptz)", [filters, p, size, now.toISOString()]);
    const all = await sqlIds(f({})); // SQL's own full order (ties between equal sort keys may differ from TypeScript's)
    sameSet(all, tsIds(f({})));
    const seen: string[] = [];
    for (let p = 1; p <= 4; p++) seen.push(...(await page(p, 6)).map((r) => idOf.get(r.id)!));
    expect(seen).toEqual(all); // 20 records over 4 pages, same order, no overlap
    const last = await page(999, 6);
    expect(last.every((r) => r.page === 4)).toBe(true);
    expect(last.map((r) => idOf.get(r.id))).toEqual(all.slice(18));
    expect((await page(-5, 6))[0]!.page).toBe(1);
    expect((await page(1, 100000)).length).toBe(20); // size capped at 100
    expect(await db.sql("select * from public.search_opportunities($1::jsonb, 1, 6, $2::timestamptz)", [JSON.stringify({ type: "health" }), now.toISOString()])).toHaveLength(0);
  });

  it("exclude_demo and scope_exact (used by the repository) behave as documented", async () => {
    expect(await sqlIds(f({}), { excludeDemo: true })).toEqual([]);
    const exact = await sqlIds(f({ scope: "azerbaijan" }), { scopeExact: true });
    const loose = await sqlIds(f({ scope: "azerbaijan" }));
    expect(loose.length - exact.length).toBe(1); // the remote competition open to both markets
    expect(loose).toContain("demo-06");
    expect(exact).not.toContain("demo-06");
  });
});
