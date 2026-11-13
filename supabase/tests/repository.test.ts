import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoUuid } from "@/db/demo-seed";
import { getDemoRecords } from "@/features/opportunities/demo-data";
import { DemoOpportunityRepository, DemoOrganizationRepository } from "@/repositories/demo/demo-repository";
import { RepositoryError, SupabaseOpportunityRepository, SupabaseOrganizationRepository } from "@/repositories/supabase/supabase-repository";
import type { SupabaseLike } from "@/lib/supabase/types";
import type { OpportunityRecord } from "@/types/opportunity";
import { parseOpportunityFilters } from "@/validation/opportunity-filters";
import { databaseAvailable, insertOpportunity, insertOrganization, TestDb } from "./helpers";

/**
 * The REAL repository classes, running as the `anon` database role (row level security in
 * force) against a real PostgreSQL with the demo seed — compared with the in-memory demo
 * repository. The adapter in helpers.ts replaces only the HTTP hop (PostgREST/supabase-js).
 */
const available = await databaseAvailable();
const f = (raw: Record<string, string> = {}) => parseOpportunityFilters(raw);

describe.skipIf(!available)("SupabaseOpportunityRepository (anon role, real database)", () => {
  const records = getDemoRecords();
  const t0 = Date.now();
  const now = new Date(t0 + 2000);
  const toDemoId = new Map<string, string>([
    ...records.map((r) => [demoUuid(r.id), r.id] as const),
    ...records.map((r) => [demoUuid(r.organization.id), r.organization.id] as const),
  ]);
  let db: TestDb;
  let repo: SupabaseOpportunityRepository;
  let demo: DemoOpportunityRepository;

  beforeAll(async () => {
    db = await TestDb.create({ seed: true, nowMs: t0, records });
    repo = new SupabaseOpportunityRepository(db.client("anon"), { includeDemo: true });
    demo = new DemoOpportunityRepository({ enabled: true });
  });
  afterAll(async () => { await db?.drop(); });

  // ── comparison helpers ────────────────────────────────────────────────────────────────────
  const ISO = /^\d{4}-\d{2}-\d{2}T/;
  /** Deep equality where ids are mapped back to demo ids and timestamps may differ by seconds. */
  function equivalent(actual: unknown, expected: unknown, path = "$"): void {
    if (typeof expected === "string" && ISO.test(expected) && typeof actual === "string" && ISO.test(actual)) {
      expect(Math.abs(Date.parse(actual) - Date.parse(expected)), `${path}: ${actual} vs ${expected}`).toBeLessThan(60_000);
    } else if (Array.isArray(expected)) {
      expect(Array.isArray(actual), path).toBe(true);
      expect((actual as unknown[]).length, `${path} length`).toBe(expected.length);
      expected.forEach((e, i) => equivalent((actual as unknown[])[i], e, `${path}[${i}]`));
    } else if (expected && typeof expected === "object") {
      expect(Object.keys(actual as object).sort(), `${path} keys`).toEqual(Object.keys(expected).sort());
      for (const [k, v] of Object.entries(expected)) equivalent((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
    } else {
      expect(actual, path).toEqual(expected);
    }
  }
  /** A DB record in the demo record's shape: uuids → demo ids, translations sorted. */
  const asDemo = (r: OpportunityRecord): OpportunityRecord => ({
    ...r,
    id: toDemoId.get(r.id)!,
    organizationId: toDemoId.get(r.organizationId)!,
    organization: { ...r.organization, id: toDemoId.get(r.organization.id)! },
    translations: [...r.translations].sort((a, b) => a.language.localeCompare(b.language)).map((t) => ({ ...t, opportunityId: toDemoId.get(t.opportunityId)! })),
  });
  const sortedTranslations = (r: OpportunityRecord): OpportunityRecord => ({ ...r, translations: [...r.translations].sort((a, b) => a.language.localeCompare(b.language)) });

  // ── reads match the reference implementation ─────────────────────────────────────────────
  it("search: pages, totals and records equal the demo repository (default sort ignoring ties)", async () => {
    const [a, b] = await Promise.all([repo.search(f(), { now }), demo.search(f(), { now })]);
    expect({ total: a.total, page: a.page, pageSize: a.pageSize, totalPages: a.totalPages }).toEqual({ total: b.total, page: b.page, pageSize: b.pageSize, totalPages: b.totalPages });
    expect(a.items).toHaveLength(6);
    expect(a.items.map((r) => toDemoId.get(r.id))).toEqual(b.items.map((r) => r.id));
  });

  it.each([
    ["newest, page 1", { sort: "newest" }],
    ["newest, page 3", { sort: "newest", page: "3" }],
    ["Azerbaijan internships by deadline", { scope: "azerbaijan", type: "internship" }],
    ["recently updated", { sort: "updated" }],
    ["keyword search in Russian", { q: "стажировка", sort: "newest" }],
    ["search by description text", { q: "fictional sample internship" }],
    ["combined filters", { type: "internship", level: "graduate", funding: "paid", sort: "newest" }],
    ["expired on request", { deadline: "expired", sort: "newest" }],
    ["page beyond the end is clamped", { page: "99", sort: "newest" }],
    ["no results", { q: "zzzqqq" }],
  ] as const)("search: %s", async (_name, raw) => {
    const filters = f(raw as Record<string, string>);
    const [a, b] = await Promise.all([repo.search(filters, { now }), demo.search(filters, { now })]);
    expect({ total: a.total, page: a.page, totalPages: a.totalPages }).toEqual({ total: b.total, page: b.page, totalPages: b.totalPages });
    expect(a.items.map((r) => toDemoId.get(r.id))).toEqual(b.items.map((r) => r.id));
    a.items.forEach((item, i) => equivalent(asDemo(item), sortedTranslations(b.items[i]!)));
  });

  it("facets and filter options equal the demo repository", async () => {
    for (const raw of [{}, { scope: "azerbaijan" }, { type: "internship" }, { q: "baku" }] as Record<string, string>[]) {
      equivalent(await repo.facets(f(raw), now), await demo.facets(f(raw), now));
    }
    const [a, b] = await Promise.all([repo.filterOptions(), demo.filterOptions()]);
    expect([...a.countries].sort()).toEqual([...b.countries].sort());
    expect(a.cities.map((c) => c.id).sort()).toEqual(b.cities.map((c) => c.id).sort());
  });

  it("getBySlug returns the complete domain record for every demo slug (organization, translations, categories)", async () => {
    for (const slug of await demo.listSlugs()) {
      const [a, b] = await Promise.all([repo.getBySlug(slug), demo.getBySlug(slug)]);
      expect(a, slug).not.toBeNull();
      equivalent(asDemo(a!), sortedTranslations(b!));
    }
    expect(await repo.getBySlug("does-not-exist")).toBeNull();
  });

  it("listSlugs and homepageGroups equal the demo repository", async () => {
    expect((await repo.listSlugs()).sort()).toEqual((await demo.listSlugs()).sort());
    const [a, b] = await Promise.all([repo.homepageGroups(3, now), demo.homepageGroups(3, now)]);
    for (const group of ["featured", "azerbaijan", "international"] as const) {
      expect(a[group].map((r) => toDemoId.get(r.id)).sort(), group).toEqual(b[group].map((r) => r.id).sort());
      expect(a[group].length).toBeLessThanOrEqual(3);
    }
    expect(a.featured.length).toBe(3);
    expect(a.azerbaijan.every((r) => r.country === "AZ")).toBe(true); // scope_exact: no records open to both markets
  });

  // ── multilingual content survives the round trip ─────────────────────────────────────────
  it("preserves original-language content, incomplete translations and hides machine drafts", async () => {
    const exchange = (await repo.getBySlug("demo-exchange-semester"))!;
    expect(exchange.originalLanguage).toBe("de");
    expect(exchange.translations.map((t) => [t.language, t.status]).sort()).toEqual([["az", "human"], ["de", "original"], ["en", "human"]]);
    expect(exchange.translations.find((t) => t.language === "az")!.requirements).toBeNull(); // incomplete stays incomplete
    const internship = (await repo.getBySlug("demo-it-internship"))!;
    expect(internship.translations.map((t) => t.language).sort()).toEqual(["az", "en"]); // the ru machine_draft is not returned
    expect(JSON.stringify(internship)).not.toContain("черновик");
  });

  // ── trust and security ────────────────────────────────────────────────────────────────────
  it("never presents an unverified record as verified; staff identities are never returned", async () => {
    const page = await repo.search(f(), { now, pageSize: 100 });
    for (const r of page.items) {
      expect(r.isDemo).toBe(true);
      expect(r.verificationStatus).toBe("unverified");
      expect(r.verifiedBy).toBeNull();
      expect(r.createdBy).toBeNull();
      expect(r.translations.every((t) => t.translatedBy === null && t.reviewedBy === null)).toBe(true);
    }
  });

  describe("with real (non-demo) records", () => {
    const created: string[] = [];
    beforeAll(async () => {
      await db.commit(async (q) => {
        const org = await insertOrganization(q, { slug: "real-org", name: "Real Org" });
        created.push(await insertOpportunity(q, { slug: "real-verified" }, { organizationId: org }));
        created.push(await insertOpportunity(q, { slug: "real-draft", publication_status: "draft", verification_status: "unverified", verified_by: null, last_verified_at: null }, { organizationId: org }));
        await insertOrganization(q, { slug: "real-orphan", name: "Orphan" });
      });
    });
    afterAll(async () => {
      await db.sql("delete from public.opportunities where slug like 'real-%'");
      await db.sql("delete from public.organizations where slug like 'real-%'");
    });

    it("returns a published, verified record as verified (with its date) and hides drafts", async () => {
      const verified = await repo.getBySlug("real-verified");
      expect(verified?.verificationStatus).toBe("verified");
      expect(verified?.lastVerifiedAt).not.toBeNull();
      expect(verified?.verifiedBy).toBeNull(); // who verified is internal
      expect(verified?.isDemo).toBe(false);
      expect(await repo.getBySlug("real-draft")).toBeNull();
      expect((await repo.listSlugs())).not.toContain("real-draft");
      expect((await repo.search(f({ q: "Başlıq" }), { now, pageSize: 100 })).items.every((r) => r.slug !== "real-draft")).toBe(true);
    });

    it("defence in depth: even a client that CAN read drafts (service role) never gets a non-public record", async () => {
      const privileged = new SupabaseOpportunityRepository(db.client("service_role"), { includeDemo: true });
      expect(await privileged.getBySlug("real-draft")).toBeNull();
      expect((await privileged.getBySlug("real-verified"))?.slug).toBe("real-verified");
      const all = await privileged.search(f(), { now, pageSize: 100 });
      expect(all.items.map((r) => r.slug)).not.toContain("real-draft");
    });

    it("organizations: only those with a visible opportunity", async () => {
      const orgs = new SupabaseOrganizationRepository(db.client("anon"), { includeDemo: true });
      const slugs = (await orgs.listPublic()).map((o) => o.slug);
      expect(slugs).toContain("real-org");
      expect(slugs).not.toContain("real-orphan");
      expect((await orgs.getBySlug("real-org"))?.name).toBe("Real Org");
      expect(await orgs.getBySlug("real-orphan")).toBeNull();
      expect(await orgs.getById("00000000-0000-4000-8000-0000000000aa")).toBeNull();
    });
  });

  describe("SHOW_DEMO_CONTENT=false (includeDemo: false)", () => {
    it("hides demo records in every query", async () => {
      const noDemo = new SupabaseOpportunityRepository(db.client("anon"), { includeDemo: false });
      expect((await noDemo.search(f(), { now })).total).toBe(0);
      expect(await noDemo.getBySlug("demo-it-internship")).toBeNull();
      expect(await noDemo.listSlugs()).toEqual([]);
      expect((await noDemo.facets(f(), now)).scope.all).toBe(0);
      expect((await noDemo.filterOptions()).countries).toEqual([]);
      const groups = await noDemo.homepageGroups(3, now);
      expect(groups.featured.length + groups.azerbaijan.length + groups.international.length).toBe(0);
      const orgs = new SupabaseOrganizationRepository(db.client("anon"), { includeDemo: false });
      expect(await orgs.listPublic()).toEqual([]);
    });
  });

  describe("organizations (demo included)", () => {
    it("match the demo organization repository", async () => {
      const [a, b] = [await new SupabaseOrganizationRepository(db.client("anon")).listPublic(), await new DemoOrganizationRepository().listPublic()];
      expect(a.map((o) => o.slug).sort()).toEqual(b.map((o) => o.slug).sort());
      expect(a.every((o) => o.isDemo && o.name.startsWith("Demo "))).toBe(true);
    });
  });

  describe("failures are loud, not silent", () => {
    const failing = (message: string): SupabaseLike => ({
      rpc: () => Promise.resolve({ data: null, error: { message } }),
      from: () => ({ select: () => { throw new Error("not used"); }, upsert: () => { throw new Error("not used"); }, update: () => { throw new Error("not used"); }, delete: () => { throw new Error("not used"); } }),
    });
    it("a failed query throws a RepositoryError instead of returning empty or demo data", async () => {
      const broken = new SupabaseOpportunityRepository(failing("connection refused"));
      await expect(broken.search(f())).rejects.toBeInstanceOf(RepositoryError);
      await expect(broken.search(f())).rejects.toThrow(/search_opportunities failed: connection refused/);
      await expect(broken.facets(f())).rejects.toThrow(/catalogue_facets failed/);
      await expect(broken.filterOptions()).rejects.toThrow(/catalogue_filter_options failed/);
    });
    it("a database error from a real call surfaces with its message", async () => {
      const error = await db.client("anon").rpc("no_such_function", {});
      expect(error.error?.message).toMatch(/no_such_function/);
    });
  });
});
