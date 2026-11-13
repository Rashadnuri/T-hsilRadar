import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./helpers";

/**
 * AUTHORIZATION AUDIT (QA phase). Instead of a hand-written list, this walks the catalogue: every
 * `admin_*` function and every table in `public` is probed as anonymous and as a signed-in
 * NON-admin. Something added later without a guard fails here.
 */
const USER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";

describe("authorization audit (catalogue-driven)", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await TestDb.create({ seed: true });
    await db.sql(`insert into auth.users (id, email) values ('${USER}', 'u@example.com'), ('${OTHER}', 'o@example.com')`);
  });
  afterAll(async () => { await db?.drop(); });

  it("every admin_* function refuses anonymous and non-admin callers", async () => {
    const fns = await db.sql<{ name: string; nargs: number }>(
      "select p.proname name, p.pronargs nargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'admin\\_%' order by 1",
    );
    expect(fns.length).toBeGreaterThanOrEqual(15);
    const failures: string[] = [];
    for (const { name, nargs } of fns) {
      const call = `select public.${name}(${Array(nargs).fill("null").join(", ")})`;
      await db.tx("anon", async (q) => {
        const e = await q.expectError(call).catch(() => null);
        if (!e) failures.push(`${name}: anon call succeeded`);
      });
      await db.tx("authenticated", async (q) => {
        const e = await q.expectError(call).catch(() => null);
        if (!e) failures.push(`${name}: non-admin call succeeded`);
        else if (!/admin|permission|not authori[sz]ed|forbidden|denied/i.test(e.message)) failures.push(`${name}: failed for another reason first → ${e.message}`);
      }, { userId: USER });
    }
    expect(failures).toEqual([]);
  });

  it("no function in public is SECURITY DEFINER", async () => {
    const rows = await db.sql<{ proname: string }>("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef");
    expect(rows).toEqual([]);
  });

  it("every table in public has row level security enabled and forced to apply to non-owners", async () => {
    const rows = await db.sql<{ relname: string }>("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity");
    expect(rows).toEqual([]);
  });

  it("a signed-in non-admin cannot delete rows from any admin-managed table", async () => {
    const managed = ["opportunities", "opportunity_translations", "organizations", "opportunity_sources", "admin_audit_log", "user_roles"];
    const failures: string[] = [];
    for (const table of managed) {
      await db.tx("authenticated", async (q) => {
        const result = await q<{ n: number }>(`with d as (delete from public.${table} returning 1) select count(*)::int n from d`).catch((e: Error) => e);
        if (!(result instanceof Error) && result[0]!.n > 0) failures.push(`${table}: a non-admin deleted rows`);
      }, { userId: USER });
    }
    expect(failures).toEqual([]);
  });

  it("a user cannot grant themselves a role, nor read anyone's role", async () => {
    await db.tx("authenticated", async (q) => {
      await q.expectError(`insert into public.user_roles (user_id, role) values ('${USER}', 'admin')`);
      await q.expectError(`update public.user_roles set role = 'admin' where user_id = '${USER}'`);
      expect(await q(`select 1 from public.user_roles where user_id <> '${USER}'`)).toEqual([]);
      expect((await q<{ ok: boolean }>("select public.is_admin() ok"))[0]!.ok).toBe(false);
    }, { userId: USER });
  });

  it("the audit log is append-only for every role, including the server key", async () => {
    await db.sql("insert into public.admin_audit_log (actor_id, action, entity) values ($1, 'test.entry', 'opportunity')", [USER]);
    for (const role of ["service_role", "authenticated", "anon"] as const) {
      await db.tx(role, async (q) => {
        await q.expectError("update public.admin_audit_log set action = 'tampered'");
        await q.expectError("delete from public.admin_audit_log");
        await q.expectError("truncate public.admin_audit_log");
      }, role === "authenticated" ? { userId: USER } : {});
    }
    // …even the owner is stopped by the trigger (only deliberately dropping it would lift that).
    await db.tx(null, async (q) => {
      await q.expectError("update public.admin_audit_log set action = 'tampered'");
      await q.expectError("delete from public.admin_audit_log");
    });
    expect(Number((await db.sql<{ n: string }>("select count(*) n from public.admin_audit_log where action = 'test.entry'"))[0]!.n)).toBe(1);
  });
});
