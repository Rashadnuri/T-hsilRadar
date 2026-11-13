import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseAvailable, insertOpportunity, insertOrganization, TestDb, type Query } from "./helpers";

const available = await databaseAvailable();
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
type Rpc = { data: unknown; error: { message: string; code?: string } | null };

describe.skipIf(!available)("sources, imports and data-quality functions", () => {
  let db: TestDb;
  let org: string;
  const admin = () => db.client("authenticated", { userId: ADMIN });
  const user = () => db.client("authenticated", { userId: USER });
  const rpc = async (c: ReturnType<TestDb["client"]>, fn: string, args: Record<string, unknown> = {}): Promise<Rpc> => (await c.rpc(fn, args)) as Rpc;
  const asUser = <R,>(id: string, fn: (q: Query) => Promise<R>) => db.tx("authenticated", fn, { userId: id });
  const fails = async (q: Query, sql: string, pattern: RegExp) => expect((await q.expectError(sql)).message, sql).toMatch(pattern);

  beforeAll(async () => {
    db = await TestDb.create();
    await db.sql(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.com'), ('${USER}', 'user@example.com')`);
    await db.sql(`insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin')`);
    await db.tx(null, async (q) => { org = await insertOrganization(q, { slug: "src-org", name: "Src Org" }); }, { commit: true });
  });
  afterAll(async () => { await db?.drop(); });

  const source = (extra: Record<string, unknown> = {}) => ({ organization_name: "Ministry of Education", website_url: "https://edu.gov.example", source_type: "government", country: "AZ", access_method: "official_website", notes: "Check the news section weekly.", ...extra });
  const opp = (extra: Record<string, unknown> = {}) => ({
    slug: "imp-1", organization_id: org, opportunity_type: "scholarship", location_type: "onsite", country: "DE", deadline_type: "rolling", official_source_url: "https://org.example.com/p",
    original_language: "az", translations: [{ language: "az", title: "İdxal imkanı", short_description: "qısa", status: "original" }], ...extra,
  });

  it("organization kinds now include scholarship organizations and development organizations", async () => {
    const kinds = (await db.sql<{ k: string }>("select unnest(enum_range(null::public.organization_kind))::text as k")).map((r) => r.k);
    expect(kinds).toEqual(expect.arrayContaining(["government", "university", "bank", "company", "it_company", "ngo", "international_org", "scholarship_org", "development_org"]));
    expect((await rpc(admin(), "admin_save_organization", { p_payload: { slug: "sch-org", kind: "scholarship_org", name: "Scholarship Foundation" } })).error).toBeNull();
    expect((await rpc(admin(), "admin_save_organization", { p_payload: { slug: "dev-org", kind: "development_org", name: "Development Agency" } })).error).toBeNull();
  });

  describe("opportunity_sources", () => {
    it("is invisible and unwritable for regular users and anon", async () => {
      await rpc(admin(), "admin_save_source", { p_payload: source() });
      await asUser(USER, async (q) => {
        expect(await q("select 1 from public.opportunity_sources")).toHaveLength(0);
        await fails(q, `insert into public.opportunity_sources (organization_name, website_url, source_type) values ('X', 'https://x.example.com', 'ngo')`, /row-level security/);
        expect(await q("update public.opportunity_sources set notes = 'hacked' returning id")).toHaveLength(0);
        expect(await q("delete from public.opportunity_sources returning id")).toHaveLength(0);
      });
      await db.tx("anon", async (q) => { await fails(q, "select 1 from public.opportunity_sources", /permission denied/); });
      for (const fn of ["admin_save_source", "admin_mark_source_checked", "admin_delete_source", "admin_duplicate_index", "admin_import_batches", "admin_expire_opportunities", "admin_quality_report"]) {
        const res = await rpc(user(), fn, fn === "admin_save_source" ? { p_payload: source({ website_url: "https://other.example.com" }) } : fn.includes("source") ? { p_id: "00000000-0000-4000-8000-000000000000" } : {});
        expect(res.error?.message, fn).toMatch(/admin access required/);
      }
    });

    it("an admin creates, edits, marks as checked, deactivates and deletes", async () => {
      const created = await rpc(admin(), "admin_save_source", { p_payload: source({ organization_name: "Bank of Example", website_url: "https://bank.example.com", source_type: "bank", access_method: "official_api" }) });
      expect(created.error).toBeNull();
      const id = created.data as string;
      expect((await db.sql<{ is_active: boolean; last_checked_at: string | null; source_type: string }>(`select is_active, last_checked_at, source_type::text from public.opportunity_sources where id = '${id}'`))[0]).toEqual({ is_active: true, last_checked_at: null, source_type: "bank" });
      expect((await rpc(admin(), "admin_save_source", { p_payload: { id, is_active: false, notes: "Paused: terms changed" } })).error).toBeNull();
      expect((await db.sql<{ is_active: boolean; notes: string; organization_name: string }>(`select is_active, notes, organization_name from public.opportunity_sources where id = '${id}'`))[0]).toEqual({ is_active: false, notes: "Paused: terms changed", organization_name: "Bank of Example" });
      expect((await rpc(admin(), "admin_mark_source_checked", { p_id: id })).error).toBeNull();
      expect((await db.sql<{ ok: boolean }>(`select last_checked_at is not null and last_checked_at <= now() as ok from public.opportunity_sources where id = '${id}'`))[0]!.ok).toBe(true);
      expect((await rpc(admin(), "admin_delete_source", { p_id: id })).error).toBeNull();
      expect((await rpc(admin(), "admin_delete_source", { p_id: id })).error?.message).toMatch(/not found/);
    });

    it("validates: https only, no HTML, unique website, country format, bad ids", async () => {
      expect((await rpc(admin(), "admin_save_source", { p_payload: source({ website_url: "http://insecure.example.com" }) })).error?.message).toMatch(/website_url/);
      expect((await rpc(admin(), "admin_save_source", { p_payload: source({ website_url: "https://nodot" }) })).error).not.toBeNull();
      expect((await rpc(admin(), "admin_save_source", { p_payload: source({ website_url: "https://user:pw@x.example.com" }) })).error).not.toBeNull();
      expect((await rpc(admin(), "admin_save_source", { p_payload: source({ website_url: "https://h.example.com", organization_name: "<b>x</b>" }) })).error).not.toBeNull();
      expect((await rpc(admin(), "admin_save_source", { p_payload: source({ website_url: "https://c.example.com", country: "azerbaijan" }) })).error).not.toBeNull();
      expect((await rpc(admin(), "admin_save_source", { p_payload: source() })).error?.code).toBe("23505"); // same website already registered
      expect((await rpc(admin(), "admin_save_source", { p_payload: source({ website_url: "https://k.example.com", source_type: "robot" }) })).error).not.toBeNull();
    });

    it("a source can be linked to an organization (set null when the organization is removed)", async () => {
      const o = (await rpc(admin(), "admin_save_organization", { p_payload: { slug: "linked-org", kind: "university", name: "Linked U" } })).data as string;
      const id = (await rpc(admin(), "admin_save_source", { p_payload: source({ website_url: "https://linked.example.edu", organization_id: o }) })).data as string;
      await rpc(admin(), "admin_delete_organization", { p_id: o });
      expect((await db.sql<{ organization_id: string | null }>(`select organization_id from public.opportunity_sources where id = '${id}'`))[0]!.organization_id).toBeNull();
    });
  });

  describe("imported opportunities", () => {
    it("are created as DRAFTS with their provenance, never published or verified", async () => {
      const src = (await rpc(admin(), "admin_save_source", { p_payload: source({ website_url: "https://prov.example.com" }) })).data as string;
      const res = await rpc(admin(), "admin_save_opportunity", { p_payload: opp({ source_id: src, import_batch: "2026-11-12-abc123", publication_status: "published", verification_status: "verified" }) });
      expect(res.error).toBeNull();
      const [row] = await db.sql<{ publication_status: string; verification_status: string; source_id: string; import_batch: string }>(`select publication_status::text, verification_status::text, source_id, import_batch from public.opportunities where id = '${res.data}'`);
      expect(row).toEqual({ publication_status: "draft", verification_status: "unverified", source_id: src, import_batch: "2026-11-12-abc123" });
    });
    it("the batch label is validated and cannot be changed by a later edit", async () => {
      expect((await rpc(admin(), "admin_save_opportunity", { p_payload: opp({ slug: "bad-batch", import_batch: "Bad Batch!" }) })).error?.message).toMatch(/import_batch/);
      const id = (await rpc(admin(), "admin_save_opportunity", { p_payload: opp({ slug: "batch-keep", import_batch: "batch-keep-1" }) })).data as string;
      await rpc(admin(), "admin_save_opportunity", { p_payload: { id, import_batch: "other-batch-2", country: "TR" } });
      expect((await db.sql<{ import_batch: string }>(`select import_batch from public.opportunities where id = '${id}'`))[0]!.import_batch).toBe("batch-keep-1");
    });
    it("batches are summarised and the list can be filtered by batch", async () => {
      await rpc(admin(), "admin_save_opportunity", { p_payload: opp({ slug: "batch-two-a", import_batch: "batch-two-77" }) });
      await rpc(admin(), "admin_save_opportunity", { p_payload: opp({ slug: "batch-two-b", import_batch: "batch-two-77" }) });
      const batches = (await rpc(admin(), "admin_import_batches")).data as { batch: string; total: number; draft: number }[];
      expect(batches.find((b) => b.batch === "batch-two-77")).toMatchObject({ total: 2, draft: 2 });
      const list = (await rpc(admin(), "admin_list_opportunities", { p_filters: { batch: "batch-two-77" }, p_page: 1, p_page_size: 50 })).data as { id: string }[];
      expect(list).toHaveLength(2);
      const imported = (await rpc(admin(), "admin_list_opportunities", { p_filters: { imported: true }, p_page: 1, p_page_size: 50 })).data as { id: string }[];
      expect(imported.length).toBeGreaterThanOrEqual(4);
    });
    it("the duplicate index lists every record with its url, deadline and titles in all languages", async () => {
      const index = (await rpc(admin(), "admin_duplicate_index")).data as { slug: string; official_source_url: string | null; titles: string[] }[];
      const row = index.find((r) => r.slug === "batch-two-a")!;
      expect(row).toMatchObject({ official_source_url: "https://org.example.com/p", titles: ["İdxal imkanı"] });
    });
  });

  describe("expiry detection and the quality report", () => {
    it("flags VERIFIED opportunities past their deadline as expired; unverified ones and open ones are untouched", async () => {
      const past = new Date(Date.now() - 5 * 86_400_000).toISOString();
      const future = new Date(Date.now() + 40 * 86_400_000).toISOString();
      const ids = await db.tx(null, async (q) => ({
        verifiedPast: await insertOpportunity(q, { slug: "q-verified-past", deadline_type: "fixed", application_deadline: past }, { organizationId: org }),
        unverifiedPast: await insertOpportunity(q, { slug: "q-unverified-past", deadline_type: "fixed", application_deadline: past, publication_status: "draft", verification_status: "unverified", verified_by: null, last_verified_at: null }, { organizationId: org }),
        verifiedOpen: await insertOpportunity(q, { slug: "q-verified-open", deadline_type: "fixed", application_deadline: future }, { organizationId: org }),
        staleVerified: await insertOpportunity(q, { slug: "q-stale", deadline_type: "rolling", application_deadline: null, last_verified_at: new Date(Date.now() - 200 * 86_400_000).toISOString() }, { organizationId: org }),
      }), { commit: true });
      const before = (await rpc(admin(), "admin_quality_report")).data as Record<string, string[]>;
      expect(before.expired_unflagged).toContain(ids.verifiedPast);
      expect(before.expired_unflagged).not.toContain(ids.verifiedOpen);
      expect(before.expired_unflagged).not.toContain(ids.unverifiedPast);
      expect(before.stale_verification).toContain(ids.staleVerified);
      expect(before.stale_verification).not.toContain(ids.verifiedOpen);

      const res = await rpc(admin(), "admin_expire_opportunities");
      expect(res.error).toBeNull();
      expect(Number(res.data)).toBeGreaterThanOrEqual(1);
      const state = async (id: string) => (await db.sql<{ v: string; p: string }>(`select verification_status::text as v, publication_status::text as p from public.opportunities where id = '${id}'`))[0]!;
      expect(await state(ids.verifiedPast)).toEqual({ v: "expired", p: "published" }); // stays visible, clearly marked expired
      expect((await state(ids.unverifiedPast)).v).toBe("unverified");
      expect((await state(ids.verifiedOpen)).v).toBe("verified");
      expect(Number((await rpc(admin(), "admin_expire_opportunities")).data)).toBe(0); // idempotent
      expect(((await rpc(admin(), "admin_quality_report")).data as Record<string, string[]>).expired_unflagged).not.toContain(ids.verifiedPast);
      expect((await db.sql("select 1 from public.admin_audit_log where action = 'opportunity.expire_check'")).length).toBeGreaterThanOrEqual(2);
    });
    it("reports sources that were never checked or not checked recently, and published records with missing translations", async () => {
      const fresh = (await rpc(admin(), "admin_save_source", { p_payload: source({ website_url: "https://fresh.example.com", last_checked_at: new Date().toISOString() }) })).data as string;
      const old = (await rpc(admin(), "admin_save_source", { p_payload: source({ website_url: "https://old.example.com", last_checked_at: new Date(Date.now() - 200 * 86_400_000).toISOString() }) })).data as string;
      const never = (await rpc(admin(), "admin_save_source", { p_payload: source({ website_url: "https://never.example.com" }) })).data as string;
      const inactive = (await rpc(admin(), "admin_save_source", { p_payload: source({ website_url: "https://inactive.example.com", is_active: false }) })).data as string;
      const report = (await rpc(admin(), "admin_quality_report")).data as Record<string, string[]>;
      expect(report.sources_overdue).toEqual(expect.arrayContaining([old, never]));
      expect(report.sources_overdue).not.toContain(fresh);
      expect(report.sources_overdue).not.toContain(inactive);
      expect(report.published_missing_translations!.length).toBeGreaterThanOrEqual(1);
    });
  });
});
