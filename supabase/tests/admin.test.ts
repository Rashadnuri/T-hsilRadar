import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseAvailable, insertOpportunity, insertOrganization, TestDb, type Query } from "./helpers";

const available = await databaseAvailable();
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Rpc = { data: unknown; error: { message: string; code?: string } | null };

describe.skipIf(!available)("administration: roles, RLS and admin functions", () => {
  let db: TestDb;
  let org: string;
  let publishedId: string;
  let draftId: string;
  let reviewId: string;

  const admin = () => db.client("authenticated", { userId: ADMIN });
  const user = () => db.client("authenticated", { userId: USER });
  const anon = () => db.client("anon");
  const rpc = async (client: ReturnType<TestDb["client"]>, fn: string, args: Record<string, unknown>): Promise<Rpc> => (await client.rpc(fn, args)) as Rpc;
  const asUser = <R,>(id: string, fn: (q: Query) => Promise<R>) => db.tx("authenticated", fn, { userId: id });
  const fails = async (q: Query, sql: string, pattern: RegExp) => expect((await q.expectError(sql)).message, sql).toMatch(pattern);

  beforeAll(async () => {
    db = await TestDb.create();
    await db.sql(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.com'), ('${ADMIN2}', 'admin2@example.com'), ('${USER}', 'user@example.com')`);
    await db.sql(`insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin'), ('${ADMIN2}', 'admin')`);
    await db.tx(null, async (q) => {
      org = await insertOrganization(q, { slug: "admin-org", name: "Admin Org" });
      publishedId = await insertOpportunity(q, { slug: "adm-published" }, { organizationId: org });
      draftId = await insertOpportunity(q, { slug: "adm-draft", publication_status: "draft", verification_status: "unverified", verified_by: null, last_verified_at: null }, { organizationId: org });
      reviewId = await insertOpportunity(q, { slug: "adm-review", publication_status: "in_review", verification_status: "unverified", verified_by: null, last_verified_at: null }, { organizationId: org });
      await insertOrganization(q, { slug: "lonely-org", name: "Org Without Opportunities" });
    }, { commit: true });
  });
  afterAll(async () => { await db?.drop(); });

  const base = (overrides: Record<string, unknown> = {}) => ({
    slug: "created-by-admin", organization_id: undefined as string | undefined, opportunity_type: "scholarship", location_type: "onsite", country: "DE",
    deadline_type: "rolling", official_source_url: "https://org.example.com/program", original_language: "az", featured: false,
    translations: [{ language: "az", title: "Orijinal başlıq", short_description: "Qısa təsvir", status: "original" }],
    ...overrides,
  });
  const create = async (overrides: Record<string, unknown> = {}) => {
    const res = await rpc(admin(), "admin_save_opportunity", { p_payload: base({ organization_id: org, ...overrides }) });
    expect(res.error, JSON.stringify(res.error)).toBeNull();
    return res.data as string;
  };

  describe("roles: nobody can grant themselves admin", () => {
    it("is_admin() is true for admins only", async () => {
      expect((await asUser(ADMIN, (q) => q<{ a: boolean }>("select public.is_admin() as a")))[0]!.a).toBe(true);
      expect((await asUser(USER, (q) => q<{ a: boolean }>("select public.is_admin() as a")))[0]!.a).toBe(false);
      expect((await db.tx("authenticated", (q) => q<{ a: boolean }>("select public.is_admin() as a")))[0]!.a).toBe(false); // no JWT at all
    });
    it("a regular user cannot insert, update or delete role rows (and so cannot promote themselves)", async () => {
      await asUser(USER, async (q) => {
        await fails(q, `insert into public.user_roles (user_id, role) values ('${USER}', 'admin')`, /permission denied/);
        await fails(q, `update public.user_roles set role = 'admin'`, /permission denied/);
        await fails(q, `delete from public.user_roles`, /permission denied/);
        await fails(q, `truncate public.user_roles`, /permission denied/);
      });
      expect(await db.sql(`select 1 from public.user_roles where user_id = '${USER}'`)).toHaveLength(0);
    });
    it("not even an admin can grant roles through the API", async () => {
      await asUser(ADMIN, async (q) => {
        await fails(q, `insert into public.user_roles (user_id, role) values ('${USER}', 'admin')`, /permission denied/);
        await fails(q, `delete from public.user_roles where user_id = '${ADMIN2}'`, /permission denied/);
      });
    });
    it("a user sees only their own role row; anon has no access at all", async () => {
      expect(await asUser(ADMIN, (q) => q("select user_id from public.user_roles"))).toHaveLength(1);
      expect(await asUser(USER, (q) => q("select user_id from public.user_roles"))).toHaveLength(0);
      await db.tx("anon", async (q) => { await fails(q, "select 1 from public.user_roles", /permission denied/); });
    });
    it("profiles have no role column to tamper with", async () => {
      expect(await db.sql("select 1 from information_schema.columns where table_name = 'profiles' and column_name ilike '%role%'")).toHaveLength(0);
    });
    it("only service_role (the operator) can write roles", async () => {
      await db.tx("service_role", async (q) => { await q(`insert into public.user_roles (user_id, role) values ('${USER}', 'admin')`); });
      expect(await db.sql("select 1 from public.user_roles where user_id = $1".replace("$1", `'${USER}'`))).toHaveLength(0); // rolled back by the test transaction
    });
  });

  describe("a regular signed-in user cannot administer anything", () => {
    it("cannot read drafts, review items or machine-draft translations (public read only)", async () => {
      await asUser(USER, async (q) => {
        const rows = await q<{ slug: string }>("select slug from public.opportunities");
        expect(rows.map((r) => r.slug)).toContain("adm-published");
        expect(rows.map((r) => r.slug)).not.toContain("adm-draft");
        expect(rows.map((r) => r.slug)).not.toContain("adm-review");
        expect(await q("select 1 from public.organizations where slug = 'lonely-org'")).toHaveLength(0);
        expect(await q("select 1 from public.admin_audit_log")).toHaveLength(0);
      });
    });
    it("direct writes are refused by row level security", async () => {
      await asUser(USER, async (q) => {
        await fails(q, `insert into public.organizations (slug, kind, name) values ('evil', 'company', 'Evil')`, /row-level security/);
        await fails(q, `insert into public.opportunities (slug, organization_id, opportunity_type, location_type, country, original_language) values ('evil', '${org}', 'scholarship', 'onsite', 'AZ', 'az')`, /row-level security/);
        await fails(q, `insert into public.admin_audit_log (actor_id, action, entity) values ('${USER}', 'x', 'y')`, /row-level security/);
      });
    });
    it("updates and deletes silently affect nothing (the rows are invisible to the write policy)", async () => {
      await asUser(USER, async (q) => {
        expect(await q(`update public.opportunities set publication_status = 'archived' where id = '${publishedId}' returning id`)).toHaveLength(0);
        expect(await q(`update public.opportunities set verification_status = 'verified' where id = '${draftId}' returning id`)).toHaveLength(0);
        expect(await q(`delete from public.opportunities where id = '${publishedId}' returning id`)).toHaveLength(0);
        expect(await q(`update public.opportunity_translations set title = 'Hacked' where opportunity_id = '${publishedId}' returning opportunity_id`)).toHaveLength(0);
        expect(await q(`update public.organizations set name = 'Hacked' where id = '${org}' returning id`)).toHaveLength(0);
        expect(await q(`delete from public.organizations where id = '${org}' returning id`)).toHaveLength(0);
      });
      const [row] = await db.sql<{ publication_status: string }>(`select publication_status from public.opportunities where id = '${publishedId}'`);
      expect(row!.publication_status).toBe("published");
    });
    it("cannot call any admin function (they refuse non-admins) and anon cannot even execute them", async () => {
      const calls: [string, Record<string, unknown>][] = [
        ["admin_save_opportunity", { p_payload: base({ organization_id: org }) }],
        ["admin_set_publication_status", { p_id: draftId, p_status: "published" }],
        ["admin_set_verification", { p_id: draftId, p_verified: true }],
        ["admin_review_translation", { p_id: draftId, p_language: "en", p_status: "machine_approved" }],
        ["admin_delete_opportunity", { p_id: draftId }],
        ["admin_save_organization", { p_payload: { slug: "x", kind: "company", name: "X" } }],
        ["admin_delete_organization", { p_id: org }],
        ["admin_list_opportunities", { p_filters: {}, p_page: 1, p_page_size: 10 }],
        ["admin_dashboard_stats", {}],
      ];
      for (const [fn, args] of calls) {
        const res = await rpc(user(), fn, args);
        expect(res.error?.message, fn).toMatch(/admin access required/);
        expect(res.error?.code, fn).toBe("42501");
        const denied = await rpc(anon(), fn, args);
        expect(denied.error?.message, `anon ${fn}`).toMatch(/permission denied/);
      }
      expect((await db.sql<{ publication_status: string }>(`select publication_status from public.opportunities where id = '${draftId}'`))[0]!.publication_status).toBe("draft");
    });
  });

  describe("an admin", () => {
    it("reads everything: drafts, review items, organizations without opportunities, the audit log", async () => {
      await asUser(ADMIN, async (q) => {
        const slugs = (await q<{ slug: string }>("select slug from public.opportunities")).map((r) => r.slug);
        expect(slugs).toEqual(expect.arrayContaining(["adm-published", "adm-draft", "adm-review"]));
        expect(await q("select 1 from public.organizations where slug = 'lonely-org'")).toHaveLength(1);
      });
    });

    it("creates an opportunity as a DRAFT, unverified, stamped with their own id, invisible to the public", async () => {
      const id = await create();
      const [row] = await db.sql<{ publication_status: string; verification_status: string; created_by: string; verified_by: string | null; is_demo: boolean }>(
        `select publication_status, verification_status, created_by, verified_by, is_demo from public.opportunities where id = '${id}'`);
      expect(row).toEqual({ publication_status: "draft", verification_status: "unverified", created_by: ADMIN, verified_by: null, is_demo: false });
      await db.tx("anon", async (q) => { expect(await q(`select 1 from public.opportunities where id = '${id}'`)).toHaveLength(0); });
      await asUser(USER, async (q) => { expect(await q(`select 1 from public.opportunities where id = '${id}'`)).toHaveLength(0); });
    });

    it("cannot create a record claiming to be published or verified, or demo, through the payload", async () => {
      const id = await create({ publication_status: "published", verification_status: "verified", is_demo: true, slug: "sneaky" });
      const [row] = await db.sql<{ publication_status: string; verification_status: string; is_demo: boolean }>(`select publication_status, verification_status, is_demo from public.opportunities where id = '${id}'`);
      expect(row).toEqual({ publication_status: "draft", verification_status: "unverified", is_demo: false });
    });

    it("refuses a record without its original-language translation (atomic: nothing is left behind)", async () => {
      const res = await rpc(admin(), "admin_save_opportunity", { p_payload: base({ organization_id: org, slug: "no-original", translations: [] }) });
      expect(res.error?.message).toMatch(/original translation/);
      expect(await db.sql("select 1 from public.opportunities where slug = 'no-original'")).toHaveLength(0);
      const wrongLanguage = await rpc(admin(), "admin_save_opportunity", { p_payload: base({ organization_id: org, slug: "wrong-lang", translations: [{ language: "en", title: "T", status: "original" }] }) });
      expect(wrongLanguage.error).not.toBeNull();
      expect(await db.sql("select 1 from public.opportunities where slug = 'wrong-lang'")).toHaveLength(0);
    });

    it("manages partial translations: az original + en human + ru machine draft; the draft is never public", async () => {
      const id = await create({
        slug: "partial-translations",
        translations: [
          { language: "az", title: "AZ başlıq", short_description: "AZ qısa", status: "original" },
          { language: "en", title: "EN title", status: "human" },
          { language: "ru", title: "RU заголовок (machine)", status: "machine_draft" },
        ],
      });
      const all = await db.sql<{ language: string; status: string; description: string | null }>(`select language, status, description from public.opportunity_translations where opportunity_id = '${id}' order by language`);
      expect(all.map((t) => `${t.language}:${t.status}`)).toEqual(["az:original", "en:human", "ru:machine_draft"]);
      expect(all.find((t) => t.language === "en")!.description).toBeNull(); // partial: absent fields stay NULL
      // publish it (verify first) and check what the public sees
      expect((await rpc(admin(), "admin_set_verification", { p_id: id, p_verified: true })).error).toBeNull();
      expect((await rpc(admin(), "admin_set_publication_status", { p_id: id, p_status: "published" })).error).toBeNull();
      await db.tx("anon", async (q) => {
        const seen = await q<{ language: string }>(`select language from public.opportunity_translations where opportunity_id = '${id}' order by language`);
        expect(seen.map((t) => t.language)).toEqual(["az", "en"]);
      });
      // approving the machine draft is an explicit admin action
      expect((await rpc(admin(), "admin_review_translation", { p_id: id, p_language: "ru", p_status: "machine_approved" })).error).toBeNull();
      await db.tx("anon", async (q) => {
        expect((await q<{ language: string }>(`select language from public.opportunity_translations where opportunity_id = '${id}' order by language`)).map((t) => t.language)).toEqual(["az", "en", "ru"]);
      });
    });

    it("preserves the original: it cannot be removed or re-labelled, and editing it outdates the other translations", async () => {
      const id = await create({ slug: "preserve-original", translations: [{ language: "az", title: "Orijinal", short_description: "q", status: "original" }, { language: "en", title: "English", status: "human" }] });
      const removal = await rpc(admin(), "admin_save_opportunity", { p_payload: { id, remove_languages: ["az", "en"] } });
      expect(removal.error).toBeNull(); // the original is skipped, the translation is removed
      expect((await db.sql<{ language: string }>(`select language from public.opportunity_translations where opportunity_id = '${id}'`)).map((t) => t.language)).toEqual(["az"]);
      expect((await rpc(admin(), "admin_review_translation", { p_id: id, p_language: "az", p_status: "machine_approved" })).error?.message).toMatch(/translation not found/);

      await rpc(admin(), "admin_save_opportunity", { p_payload: { id, translations: [{ language: "en", title: "English", status: "human" }] } });
      await rpc(admin(), "admin_save_opportunity", { p_payload: { id, translations: [{ language: "az", title: "Dəyişdirilmiş orijinal", short_description: "q", status: "original" }] } });
      const rows = await db.sql<{ language: string; status: string }>(`select language, status from public.opportunity_translations where opportunity_id = '${id}' order by language`);
      expect(rows).toEqual([{ language: "az", status: "original" }, { language: "en", status: "outdated" }]);
      expect((await db.sql<{ content_version: number }>(`select content_version from public.opportunities where id = '${id}'`))[0]!.content_version).toBe(2);
    });

    it("updates only the keys in the payload and never status, verification or the original language", async () => {
      const id = await create({ slug: "partial-update" });
      const res = await rpc(admin(), "admin_save_opportunity", { p_payload: { id, country: "TR", original_language: "ru", publication_status: "published", verification_status: "verified" } });
      expect(res.error).toBeNull();
      const [row] = await db.sql<{ country: string; original_language: string; publication_status: string; verification_status: string; official_source_url: string }>(
        `select country, original_language, publication_status, verification_status, official_source_url from public.opportunities where id = '${id}'`);
      expect(row).toEqual({ country: "TR", original_language: "az", publication_status: "draft", verification_status: "unverified", official_source_url: "https://org.example.com/program" });
      expect((await rpc(admin(), "admin_save_opportunity", { p_payload: { id: "00000000-0000-4000-8000-000000000000", country: "TR" } })).error?.message).toMatch(/not found/);
    });

    describe("publication requirements (enforced by the database, not only the form)", () => {
      it("cannot publish an unverified record", async () => {
        const id = await create({ slug: "needs-verification" });
        const res = await rpc(admin(), "admin_set_publication_status", { p_id: id, p_status: "published" });
        expect(res.error?.message).toMatch(/opportunities_published_requirements/);
      });
      it("cannot publish without an official source URL", async () => {
        const id = await create({ slug: "needs-source", official_source_url: null });
        expect((await rpc(admin(), "admin_set_verification", { p_id: id, p_verified: true })).error).toBeNull();
        expect((await rpc(admin(), "admin_set_publication_status", { p_id: id, p_status: "published" })).error?.message).toMatch(/opportunities_published_requirements/);
      });
      it("cannot publish with an unknown deadline: a date or an explicit 'rolling' is required", async () => {
        const id = await create({ slug: "needs-deadline", deadline_type: "unknown" });
        await rpc(admin(), "admin_set_verification", { p_id: id, p_verified: true });
        expect((await rpc(admin(), "admin_set_publication_status", { p_id: id, p_status: "published" })).error?.message).toMatch(/opportunities_published_deadline/);
        await rpc(admin(), "admin_save_opportunity", { p_payload: { id, deadline_type: "fixed", application_deadline: "2099-01-01T12:00:00Z" } });
        expect((await rpc(admin(), "admin_set_publication_status", { p_id: id, p_status: "published" })).error).toBeNull();
      });
      it("cannot publish without a short description of the original (translation invariant)", async () => {
        const id = await create({ slug: "needs-short", translations: [{ language: "az", title: "Yalnız başlıq", status: "original" }] });
        await rpc(admin(), "admin_set_verification", { p_id: id, p_verified: true });
        expect((await rpc(admin(), "admin_set_publication_status", { p_id: id, p_status: "published" })).error?.message).toMatch(/short_description/);
      });
      it("a published record cannot be un-verified or deleted; archive first", async () => {
        const id = await create({ slug: "published-guard" });
        await rpc(admin(), "admin_set_verification", { p_id: id, p_verified: true });
        expect((await rpc(admin(), "admin_set_publication_status", { p_id: id, p_status: "published" })).error).toBeNull();
        expect((await rpc(admin(), "admin_set_verification", { p_id: id, p_verified: false })).error?.message).toMatch(/opportunities_published_requirements/);
        expect((await rpc(admin(), "admin_delete_opportunity", { p_id: id })).error?.message).toMatch(/archive a published/);
        expect((await rpc(admin(), "admin_set_publication_status", { p_id: id, p_status: "archived" })).error).toBeNull();
        await db.tx("anon", async (q) => { expect(await q(`select 1 from public.opportunities where id = '${id}'`)).toHaveLength(0); });
        expect((await rpc(admin(), "admin_delete_opportunity", { p_id: id })).error).toBeNull();
        expect(await db.sql(`select 1 from public.opportunities where id = '${id}'`)).toHaveLength(0);
        expect(await db.sql(`select 1 from public.opportunity_translations where opportunity_id = '${id}'`)).toHaveLength(0);
      });
      it("the five statuses can be set: draft, in_review, published, rejected, archived", async () => {
        const id = await create({ slug: "all-statuses" });
        await rpc(admin(), "admin_set_verification", { p_id: id, p_verified: true });
        for (const status of ["in_review", "rejected", "draft", "in_review", "published", "archived", "draft"]) {
          expect((await rpc(admin(), "admin_set_publication_status", { p_id: id, p_status: status })).error, status).toBeNull();
          expect((await db.sql<{ s: string }>(`select publication_status::text as s from public.opportunities where id = '${id}'`))[0]!.s).toBe(status);
        }
        expect((await rpc(admin(), "admin_set_publication_status", { p_id: id, p_status: "bogus" })).error).not.toBeNull();
      });
      it("published_at is set when first published", async () => {
        const id = await create({ slug: "published-at" });
        await rpc(admin(), "admin_set_verification", { p_id: id, p_verified: true });
        await rpc(admin(), "admin_set_publication_status", { p_id: id, p_status: "published" });
        expect((await db.sql<{ p: boolean }>(`select published_at is not null as p from public.opportunities where id = '${id}'`))[0]!.p).toBe(true);
      });
    });

    describe("verification", () => {
      it("records who and when; only the acting admin can be stamped as the verifier", async () => {
        const id = await create({ slug: "verify-me" });
        expect((await rpc(admin(), "admin_set_verification", { p_id: id, p_verified: true })).error).toBeNull();
        const [row] = await db.sql<{ verified_by: string; v: string; at: boolean }>(`select verified_by, verification_status::text as v, last_verified_at is not null as at from public.opportunities where id = '${id}'`);
        expect(row).toEqual({ verified_by: ADMIN, v: "verified", at: true });
        await asUser(ADMIN2, async (q) => {
          await fails(q, `update public.opportunities set verified_by = '${ADMIN}' where id = '${draftId}'`, /acting admin/); // forging the verifier
        });
        expect((await rpc(admin(), "admin_set_verification", { p_id: id, p_verified: false })).error).toBeNull();
        expect((await db.sql<{ verified_by: string | null }>(`select verified_by from public.opportunities where id = '${id}'`))[0]!.verified_by).toBeNull();
      });
      it("verifier identity is not readable through the API", async () => {
        await asUser(ADMIN, async (q) => { await fails(q, "select verified_by from public.opportunities", /permission denied/); });
      });
    });

    describe("organizations", () => {
      it("creates, edits and deletes; refuses to delete one that is in use; cannot create demo organizations", async () => {
        const created = await rpc(admin(), "admin_save_organization", { p_payload: { slug: "new-org", kind: "ngo", name: "New Org", country: "AZ", website_url: "https://new-org.example.com" } });
        expect(created.error).toBeNull();
        const id = created.data as string;
        expect((await rpc(admin(), "admin_save_organization", { p_payload: { id, name: "Renamed Org" } })).error).toBeNull();
        expect((await db.sql<{ name: string; slug: string; is_demo: boolean }>(`select name, slug, is_demo from public.organizations where id = '${id}'`))[0]).toEqual({ name: "Renamed Org", slug: "new-org", is_demo: false });
        expect((await rpc(admin(), "admin_delete_organization", { p_id: org })).error?.message).toMatch(/foreign key|violates/);
        expect((await rpc(admin(), "admin_delete_organization", { p_id: id })).error).toBeNull();
        await asUser(ADMIN, async (q) => { await fails(q, `insert into public.organizations (slug, kind, name, is_demo) values ('demo-org', 'company', 'D', true)`, /permission denied|row-level security/); });
      });
      it("validates through the table constraints (https URL, no HTML)", async () => {
        expect((await rpc(admin(), "admin_save_organization", { p_payload: { slug: "bad-url", kind: "ngo", name: "Bad", website_url: "http://insecure.example.com" } })).error).not.toBeNull();
        expect((await rpc(admin(), "admin_save_organization", { p_payload: { slug: "bad-html", kind: "ngo", name: "<b>Bad</b>" } })).error).not.toBeNull();
      });
    });

    describe("lists and counters", () => {
      it("filters by status, verification, expiry and a folded title search, with paging", async () => {
        const expiredId = await create({ slug: "list-expired", deadline_type: "fixed", application_deadline: "2020-01-01T00:00:00Z", translations: [{ language: "az", title: "Təcrübə proqramı", short_description: "q", status: "original" }] });
        const list = async (filters: Record<string, unknown>, page = 1, size = 50) => {
          const res = await rpc(admin(), "admin_list_opportunities", { p_filters: filters, p_page: page, p_page_size: size });
          expect(res.error, JSON.stringify(res.error)).toBeNull();
          return res.data as { id: string; total_count: number; page: number }[];
        };
        expect((await list({ status: "in_review" })).map((r) => r.id)).toContain(reviewId);
        expect((await list({ status: "in_review" })).map((r) => r.id)).not.toContain(draftId);
        expect((await list({ verification: "verified" })).map((r) => r.id)).toContain(publishedId);
        expect((await list({ expired: true })).map((r) => r.id)).toContain(expiredId);
        expect((await list({ expired: true })).map((r) => r.id)).not.toContain(publishedId);
        expect((await list({ q: "tecrube" })).map((r) => r.id)).toEqual([expiredId]); // folded: təcrübə ≈ tecrube
        expect((await list({ q: "list-expired" })).map((r) => r.id)).toEqual([expiredId]); // slug search
        const first = await list({}, 1, 2);
        expect(first).toHaveLength(2);
        expect(Number(first[0]!.total_count)).toBeGreaterThan(2);
        const beyond = await list({}, 999, 2);
        expect(beyond.length).toBeGreaterThan(0); // page is clamped to the last one
      });
      it("dashboard counters add up", async () => {
        const stats = (await rpc(admin(), "admin_dashboard_stats", {})).data as { total: number; by_status: Record<string, number>; unverified: number; expired: number; missing_translations: number; organizations: number };
        const [{ n }] = (await db.sql<{ n: string }>("select count(*) as n from public.opportunities")) as [{ n: string }];
        expect(stats.total).toBe(Number(n));
        expect(Object.values(stats.by_status).reduce((a, b) => a + b, 0)).toBe(stats.total);
        expect(stats.expired).toBeGreaterThanOrEqual(1);
        expect(stats.missing_translations).toBeGreaterThanOrEqual(1);
        expect(stats.organizations).toBeGreaterThanOrEqual(2);
      });
    });

    describe("audit log", () => {
      it("records who did what, append-only, readable by admins only", async () => {
        const id = await create({ slug: "audited" });
        await rpc(admin(), "admin_set_verification", { p_id: id, p_verified: true });
        const rows = await db.sql<{ actor_id: string; action: string; entity_id: string }>(`select actor_id, action, entity_id from public.admin_audit_log where entity_id = '${id}' order by id`);
        expect(rows.map((r) => r.action)).toEqual(["opportunity.save", "opportunity.verify"]);
        expect(rows.every((r) => r.actor_id === ADMIN)).toBe(true);
        await asUser(ADMIN, async (q) => {
          expect((await q("select 1 from public.admin_audit_log")).length).toBeGreaterThan(0);
          await fails(q, "update public.admin_audit_log set action = 'x'", /permission denied/);
          await fails(q, "delete from public.admin_audit_log", /permission denied/);
          await fails(q, `insert into public.admin_audit_log (actor_id, action, entity) values ('${USER}', 'forged', 'opportunity')`, /row-level security/); // cannot forge another actor
        });
        await asUser(USER, async (q) => { expect(await q("select 1 from public.admin_audit_log")).toHaveLength(0); });
      });
    });
  });

  it("no SECURITY DEFINER anywhere: admin power comes from rows (roles), never from privileged functions", async () => {
    expect(await db.sql("select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef")).toEqual([]);
  });
});
