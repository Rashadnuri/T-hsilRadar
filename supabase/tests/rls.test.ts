import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OPPORTUNITY_COLUMNS, TRANSLATION_COLUMNS } from "@/lib/supabase/types";
import { databaseAvailable, insertOpportunity, insertOrganization, TestDb, type Query } from "./helpers";

const available = await databaseAvailable();
const PUBLIC_ROLES = ["anon", "authenticated"] as const;
const PRIVATE = ["profiles", "saved_opportunities", "applications", "user_roles", "admin_audit_log", "opportunity_sources"];
/** The public catalogue: read-only for public roles. (`profiles` is private and tested in profiles.test.ts.) */
const TABLES = ["categories", "cities", "organizations", "opportunities", "opportunity_categories", "opportunity_translations"] as const;
const draft = { verification_status: "unverified", verified_by: null, last_verified_at: null };

describe.skipIf(!available)("row level security and privileges", () => {
  let db: TestDb;
  beforeAll(async () => { db = await TestDb.create(); });
  afterAll(async () => { await db?.drop(); });

  /** Inserts the visibility matrix as the owner, then returns the ids by label. */
  async function matrix(q: Query) {
    const ids: Record<string, string> = {};
    const add = async (label: string, overrides: Record<string, unknown>, translations?: Record<string, unknown>[]) => {
      ids[label] = await insertOpportunity(q, { slug: `m-${label.replace(/_/g, "-")}`, ...overrides }, translations ? { translations } : {});
    };
    await add("verified", {}, [
      { language: "az", status: "original", title: "Orijinal", short_description: "Qısa" },
      { language: "en", status: "human", title: "Human EN", translated_from: "az" },
      { language: "ru", status: "machine_draft", title: "Machine draft RU", translated_from: "az" },
    ]);
    await add("expired", { verification_status: "expired", application_deadline: new Date(Date.now() - 86_400_000).toISOString() });
    await add("demo", { is_demo: true, ...draft });
    await add("draft", { publication_status: "draft" });
    await add("in_review", { publication_status: "in_review" });
    await add("unpublished", { publication_status: "unpublished" });
    await add("archived", { publication_status: "archived" });
    await add("unverified_draft", { publication_status: "draft", ...draft });
    await add("rejected_draft", { publication_status: "draft", verification_status: "rejected", verified_by: null, last_verified_at: null });
    return ids;
  }
  const visibleLabels = ["verified", "expired", "demo"];

  describe.each(PUBLIC_ROLES)("%s can read only published, verified (or flagged demo) opportunities", (role) => {
    it("sees exactly the verified, expired and demo records — not drafts, review, unpublished, archived or unverified", async () => {
      await db.tx(role, async (q) => {
        // fixtures must be inserted as the owner
        await q("reset role");
        const ids = await matrix(q);
        await q(`set local role ${role}`);
        const seen = await q<{ id: string }>("select id from public.opportunities");
        const byId = Object.fromEntries(Object.entries(ids).map(([label, id]) => [id, label]));
        expect(seen.map((r) => byId[r.id]).sort()).toEqual([...visibleLabels].sort());
      });
    });

    it("sees translations only of visible opportunities, never machine drafts", async () => {
      await db.tx(role, async (q) => {
        await q("reset role");
        const ids = await matrix(q);
        await q(`set local role ${role}`);
        const rows = await q<{ opportunity_id: string; language: string; status: string }>("select opportunity_id, language, status from public.opportunity_translations");
        expect(rows.every((r) => r.status !== "machine_draft")).toBe(true);
        const visibleIds = new Set(visibleLabels.map((l) => ids[l]));
        expect(rows.every((r) => visibleIds.has(r.opportunity_id))).toBe(true);
        expect(rows.filter((r) => r.opportunity_id === ids.verified).map((r) => r.language).sort()).toEqual(["az", "en"]); // ru draft hidden
        expect(await q("select 1 from public.opportunity_translations where status = 'machine_draft'")).toHaveLength(0);
      });
    });

    it("sees an organization only when it has a visible opportunity", async () => {
      await db.tx(role, async (q) => {
        await q("reset role");
        const hidden = await insertOrganization(q, { slug: "org-hidden", name: "Hidden Org" });
        await insertOpportunity(q, { publication_status: "draft" }, { organizationId: hidden });
        const shown = await insertOrganization(q, { slug: "org-shown", name: "Shown Org" });
        await insertOpportunity(q, {}, { organizationId: shown });
        await insertOrganization(q, { slug: "org-orphan", name: "Orphan Org" });
        await q(`set local role ${role}`);
        expect((await q<{ name: string }>("select name from public.organizations")).map((r) => r.name)).toEqual(["Shown Org"]);
      });
    });

    it("sees category links only of visible opportunities, and only active categories", async () => {
      await db.tx(role, async (q) => {
        await q("reset role");
        const ids = await matrix(q);
        await q("update public.categories set is_active = false where code = 'hackathon'");
        await q(`set local role ${role}`);
        const links = await q<{ opportunity_id: string }>("select opportunity_id from public.opportunity_categories");
        expect(new Set(links.map((l) => l.opportunity_id))).toEqual(new Set(visibleLabels.map((l) => ids[l])));
        const codes = (await q<{ code: string }>("select code from public.categories")).map((c) => c.code);
        expect(codes).not.toContain("hackathon");
        expect(codes).toHaveLength(11);
        expect(await q("select 1 from public.cities")).toHaveLength(14);
      });
    });

    it("the search functions return only visible opportunities (RLS applies inside them)", async () => {
      await db.tx(role, async (q) => {
        await q("reset role");
        const ids = await matrix(q);
        await q(`set local role ${role}`);
        const rows = await q<{ id: string; total_count: number }>("select id, total_count from public.search_opportunities('{}'::jsonb, 1, 100, now())");
        const byId = Object.fromEntries(Object.entries(ids).map(([label, id]) => [id, label]));
        // `expired` is visible but not listed as active
        expect(rows.map((r) => byId[r.id]).sort()).toEqual(["demo", "verified"]);
        const facets = await q<{ f: { scope: { all: number } } }>("select public.catalogue_facets('{}'::jsonb, now()) as f");
        expect(facets[0]!.f.scope.all).toBe(2);
      });
    });
  });

  describe("defence in depth: RLS hides records even if a CHECK constraint were bypassed", () => {
    it("published + unverified (non-demo) and published + rejected are invisible to the public", async () => {
      await db.tx(null, async (q) => {
        await q("alter table public.opportunities drop constraint opportunities_published_requirements");
        const unverified = await insertOpportunity(q, { slug: "dd-unverified", ...draft });
        const rejected = await insertOpportunity(q, { slug: "dd-rejected", verification_status: "rejected", verified_by: null, last_verified_at: null });
        const noSource = await insertOpportunity(q, { slug: "dd-nosource", official_source_url: null });
        await q("set local role anon");
        const seen = (await q<{ id: string }>("select id from public.opportunities")).map((r) => r.id);
        expect(seen).toContain(noSource); // verified + published: visible (the missing source is a CHECK concern, not an RLS one)
        expect(seen).not.toContain(unverified);
        expect(seen).not.toContain(rejected);
      });
    });
    it("is_publicly_visible is the single definition", async () => {
      const cases: [string, string, boolean, boolean][] = [
        ["published", "verified", false, true], ["published", "expired", false, true], ["published", "unverified", false, false],
        ["published", "rejected", false, false], ["published", "unverified", true, true], ["draft", "verified", false, false],
        ["in_review", "verified", true, false], ["unpublished", "verified", false, false], ["archived", "verified", false, false],
      ];
      for (const [pub, ver, demo, expected] of cases) {
        const v = (await db.sql<{ v: boolean }>(`select public.is_publicly_visible('${pub}'::public.publication_status, '${ver}'::public.verification_status, ${demo}) as v`))[0]!.v;
        expect(v, `${pub}/${ver}/demo=${demo}`).toBe(expected);
      }
    });
  });

  // (Regular signed-in users and admins are covered in admin.test.ts: `authenticated` has admin-gated write policies.)
  describe.each(["anon"] as const)("%s cannot create, update or delete anything", (role) => {
    const statements = (table: string): string[] => [
      `insert into public.${table} select * from public.${table} limit 0`,
      `update public.${table} set created_at = now()`,
      `delete from public.${table}`,
      `truncate public.${table}`,
    ];
    it.each(TABLES)("%s: INSERT, UPDATE, DELETE and TRUNCATE are denied", async (table) => {
      for (const sql of statements(table)) {
        await db.tx(role, async (q) => {
          const error = await q.expectError(sql);
          expect(error.message, sql).toMatch(/permission denied|row-level security|must be owner/i);
        });
      }
    });

    it("cannot publish, verify or alter a record, even one they can read", async () => {
      await db.tx(null, async (q) => {
        const id = await insertOpportunity(q);
        await q(`set local role ${role}`);
        for (const sql of [
          `update public.opportunities set verification_status = 'verified' where id = '${id}'`,
          `update public.opportunities set publication_status = 'published' where id = '${id}'`,
          `update public.opportunity_translations set title = 'Hacked' where opportunity_id = '${id}'`,
          `delete from public.opportunities where id = '${id}'`,
          `insert into public.opportunity_categories (opportunity_id, category_code) values ('${id}', 'research')`,
        ]) {
          expect((await q.expectError(sql)).message).toMatch(/permission denied/i);
        }
      });
    });

    it("cannot read internal columns (who verified, created or translated a record)", async () => {
      await db.tx(null, async (q) => {
        await insertOpportunity(q);
        await q(`set local role ${role}`);
        for (const sql of [
          "select verified_by from public.opportunities", "select created_by from public.opportunities",
          "select * from public.opportunities", "select translated_by from public.opportunity_translations",
          "select reviewed_by from public.opportunity_translations", "select * from public.opportunity_translations",
        ]) {
          expect((await q.expectError(sql)).message, sql).toMatch(/permission denied/i);
        }
        // the columns the application actually selects are allowed
        await q(`select ${OPPORTUNITY_COLUMNS.join(", ")} from public.opportunities`);
        await q(`select ${TRANSLATION_COLUMNS.join(", ")} from public.opportunity_translations`);
      });
    });
  });

  describe("privileges and policies as stored in the catalog", () => {
    it("every public table has RLS enabled", async () => {
      const rows = await db.sql<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'");
      expect(rows.map((r) => r.relname).sort()).toEqual([...TABLES, ...PRIVATE].sort());
      expect(rows.filter((r) => !r.relrowsecurity)).toEqual([]);
    });
    it("catalogue policies are SELECT-only; the only write policies are owner-only ones on the private tables", async () => {
      const rows = await db.sql<{ tablename: string; cmd: string; roles: string[]; qual: string | null; with_check: string | null }>("select tablename, cmd, roles::text[] as roles, qual, with_check from pg_policies where schemaname = 'public'");
      const catalogue = rows.filter((r) => !PRIVATE.includes(r.tablename));
      // Public read policies: SELECT-only, anon + authenticated.
      const publicRead = catalogue.filter((r) => r.roles.includes("anon"));
      expect(publicRead).toHaveLength(6);
      expect(publicRead.filter((r) => r.cmd !== "SELECT")).toEqual([]);
      for (const r of publicRead) expect(r.roles.sort()).toEqual(["anon", "authenticated"]);
      // Everything else on the catalogue is an ADMIN policy: signed-in role only, and gated by is_admin().
      const adminPolicies = catalogue.filter((r) => !r.roles.includes("anon"));
      expect(adminPolicies.length).toBeGreaterThan(10);
      for (const r of adminPolicies) {
        expect(r.roles).toEqual(["authenticated"]);
        expect(`${r.qual ?? ""} ${r.with_check ?? ""}`).toContain("is_admin()");
      }
      const profiles = rows.filter((r) => r.tablename === "profiles");
      expect(profiles.map((r) => r.cmd).sort()).toEqual(["INSERT", "SELECT", "UPDATE"]); // no DELETE, no ALL
      const roles = rows.filter((r) => r.tablename === "user_roles");
      expect(roles.map((r) => r.cmd)).toEqual(["SELECT"]); // nobody can grant a role through the API
      for (const r of profiles) {
        expect(r.roles).toEqual(["authenticated"]); // anon has no policy at all
        expect(`${r.qual ?? ""} ${r.with_check ?? ""}`).toContain("auth.uid()");
      }
    });
    it("on the catalogue, anon holds only SELECT privileges (table- and column-level)", async () => {
      const privileges = await db.sql<{ privilege_type: string }>("select distinct privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name not in ('profiles', 'saved_opportunities', 'applications', 'user_roles', 'admin_audit_log', 'opportunity_sources') and grantee = 'anon'");
      expect(privileges.filter((p) => p.privilege_type !== "SELECT")).toEqual([]);
      const columnPrivileges = await db.sql<{ privilege_type: string }>("select distinct privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name not in ('profiles', 'saved_opportunities', 'applications', 'user_roles', 'admin_audit_log', 'opportunity_sources') and grantee = 'anon'");
      expect(columnPrivileges.map((p) => p.privilege_type)).toEqual(["SELECT"]);
    });
    it("anon has no privilege on the admin tables, and authenticated cannot write roles or the audit log's history", async () => {
      for (const table of ["user_roles", "admin_audit_log", "opportunity_sources"]) {
        expect(await db.sql(`select 1 from information_schema.role_table_grants where table_name = '${table}' and grantee = 'anon'`)).toHaveLength(0);
        expect(await db.sql(`select 1 from information_schema.column_privileges where table_name = '${table}' and grantee = 'anon'`)).toHaveLength(0);
      }
      const roleWrites = await db.sql("select privilege_type from information_schema.role_table_grants where table_name = 'user_roles' and grantee = 'authenticated' and privilege_type <> 'SELECT'");
      expect(roleWrites).toEqual([]);
      const roleColumnWrites = await db.sql("select privilege_type from information_schema.column_privileges where table_name = 'user_roles' and grantee = 'authenticated' and privilege_type <> 'SELECT'");
      expect(roleColumnWrites).toEqual([]);
      const auditUpdates = await db.sql("select privilege_type from information_schema.column_privileges where table_name = 'admin_audit_log' and grantee = 'authenticated' and privilege_type in ('UPDATE', 'DELETE')");
      expect(auditUpdates).toEqual([]);
    });
    it("profiles: anon has NO privilege at all; authenticated may select, and insert/update only owned columns (never delete or truncate)", async () => {
      const anon = await db.sql("select 1 from information_schema.role_table_grants where table_name = 'profiles' and grantee = 'anon'");
      const anonCols = await db.sql("select 1 from information_schema.column_privileges where table_name = 'profiles' and grantee = 'anon'");
      expect(anon).toHaveLength(0);
      expect(anonCols).toHaveLength(0);
      const authTable = await db.sql<{ privilege_type: string }>("select privilege_type from information_schema.role_table_grants where table_name = 'profiles' and grantee = 'authenticated'");
      expect(authTable.map((p) => p.privilege_type)).toEqual(["SELECT"]);
    });
    it("exactly the moderator-identity columns are hidden from public roles", async () => {
      const all = await db.sql<{ table_name: string; column_name: string }>("select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('opportunities', 'opportunity_translations')");
      const hidden: string[] = [];
      for (const c of all) {
        const ok = (await db.sql<{ ok: boolean }>(`select has_column_privilege('anon', 'public.${c.table_name}', '${c.column_name}', 'select') as ok`))[0]!.ok;
        if (!ok) hidden.push(`${c.table_name}.${c.column_name}`);
      }
      // provenance (source_id, import_batch) is internal too: hidden from anon (signed-in users can read these two non-personal columns, which admins need).
      expect(hidden.sort()).toEqual(["opportunities.created_by", "opportunities.import_batch", "opportunities.source_id", "opportunities.verified_by", "opportunity_translations.reviewed_by", "opportunity_translations.translated_by"]);
    });
    it("tables created in future migrations are private by default (default privileges)", async () => {
      await db.tx(null, async (q) => {
        await q("create table public.future_table (id int)");
        const [row] = await q<{ anon: boolean; auth: boolean }>("select has_table_privilege('anon', 'public.future_table', 'select') as anon, has_table_privilege('authenticated', 'public.future_table', 'select') as auth");
        expect(row).toEqual({ anon: false, auth: false });
      });
    });
    it("search functions are SECURITY INVOKER and callable by the public roles only through explicit grants", async () => {
      const fns = await db.sql<{ proname: string; prosecdef: boolean }>("select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace and proname in ('opportunity_search_rows', 'search_opportunities', 'catalogue_facets', 'catalogue_filter_options')");
      expect(fns).toHaveLength(4);
      expect(fns.filter((f) => f.prosecdef)).toEqual([]);
      for (const role of ["anon", "authenticated", "service_role"]) {
        const ok = (await db.sql<{ ok: boolean }>(`select has_function_privilege('${role}', 'public.search_opportunities(jsonb,integer,integer,timestamptz)', 'execute') as ok`))[0]!.ok;
        expect(ok).toBe(true);
      }
      const pub = (await db.sql<{ pub: boolean }>("select has_function_privilege('public', 'public.search_opportunities(jsonb,integer,integer,timestamptz)', 'execute') as pub"))[0]!.pub;
      expect(pub).toBe(false);
    });
    it("no function in the public schema is SECURITY DEFINER", async () => {
      expect(await db.sql("select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef")).toEqual([]);
    });
  });

  describe("service_role (trusted server code) bypasses RLS and manages the data", () => {
    it("sees every record including drafts and machine drafts, and can write", async () => {
      await db.tx(null, async (q) => {
        const ids = await matrix(q);
        await q("set local role service_role");
        expect((await q("select id from public.opportunities")).length).toBe(Object.keys(ids).length);
        expect(await q("select 1 from public.opportunity_translations where status = 'machine_draft'")).toHaveLength(1);
        await q(`update public.opportunities set featured = true where id = '${ids.draft}'`);
        await q(`update public.opportunities set publication_status = 'in_review' where id = '${ids.draft}'`);
        await q("insert into public.organizations (slug, kind, name) values ('svc-org', 'ngo', 'Service Org')");
      });
    });
  });
});
