import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client, types } from "pg";
import { generateDemoSeedSql } from "@/db/demo-seed";
import { getDemoRecords } from "@/features/opportunities/demo-data";
import type { MutationQuery, QueryResult, SelectQuery, SupabaseLike } from "@/lib/supabase/types";
import type { OpportunityRecord } from "@/types/opportunity";

/**
 * Database test harness.
 *
 * Each suite creates a THROW-AWAY database on a real PostgreSQL server, mimics a Supabase
 * project (anon / authenticated / service_role roles, Supabase's "grant everything by default"
 * privileges, the `extensions` schema), applies EVERY migration in order, optionally loads the
 * demo seed, and drops the database afterwards.
 *
 * Connection: TEST_DATABASE_URL (a superuser, e.g. the local Supabase stack:
 * postgresql://postgres:postgres@127.0.0.1:54322/postgres). When no server is reachable the
 * database suites are SKIPPED (with a message), so `npm test` still works anywhere.
 */

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://tahsil_test:tahsil_test@127.0.0.1:5432/postgres";
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

// Like PostgREST: bigint/numeric as JSON numbers, timestamps as ISO strings.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

export type Role = "anon" | "authenticated" | "service_role";

export async function databaseAvailable(): Promise<boolean> {
  const client = new Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    console.warn(`[db tests] no PostgreSQL reachable at the TEST_DATABASE_URL (${ADMIN_URL.replace(/:[^:@]*@/, ":***@")}); database suites are skipped.`);
    return false;
  }
}

const SUPABASE_LIKE_SETUP = `
  do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
    if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  end $$;
  alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`;

/**
 * The slice of Supabase Auth that migrations and RLS depend on: auth.users and auth.uid().
 * auth.uid() is defined as in Supabase (it reads the verified JWT claims PostgREST sets per request).
 */
const AUTH_STUB = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
`;

export interface Query {
  <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs `sql`, expects it to fail, rolls back to a savepoint and returns the error. */
  expectError(sql: string, params?: unknown[]): Promise<{ message: string; code?: string }>;
}

export class TestDb {
  private constructor(readonly name: string, private readonly admin: Client, private readonly root: Client) {}

  static async create(options: { seed?: boolean; nowMs?: number; records?: OpportunityRecord[] } = {}): Promise<TestDb> {
    const name = `tahsil_test_${randomBytes(4).toString("hex")}`;
    const root = new Client({ connectionString: ADMIN_URL });
    await root.connect();
    // Roles are cluster-wide; create them idempotently from the root connection.
    await root.query(SUPABASE_LIKE_SETUP.split("alter default")[0]!);
    await root.query(`create database ${name} template template0 encoding 'UTF8' lc_collate 'C.UTF-8' lc_ctype 'C.UTF-8'`);

    const url = new URL(ADMIN_URL);
    url.pathname = `/${name}`;
    const admin = new Client({ connectionString: url.toString() });
    await admin.connect();
    const db = new TestDb(name, admin, root);
    await admin.query("set role postgres"); // objects are owned by `postgres`, as in Supabase
    await admin.query(`alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
      grant usage on schema public to anon, authenticated, service_role;`);
    await admin.query(AUTH_STUB);
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
      try {
        await admin.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
      } catch (error) {
        await db.drop();
        throw new Error(`migration ${file} failed: ${(error as Error).message}`);
      }
    }
    if (options.seed) await admin.query(generateDemoSeedSql(options.records ?? getDemoRecords(), options.nowMs ?? Date.now()));
    return db;
  }

  /** As the superuser/owner (no RLS), autocommit. */
  async sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
    return (await this.admin.query(text, params)).rows as T[];
  }

  /** One transaction that is ALWAYS rolled back, executed as `role` (or the owner when omitted). */
  async tx<R>(role: Role | null, fn: (q: Query) => Promise<R>, options: { userId?: string; commit?: boolean } = {}): Promise<R> {
    await this.admin.query("begin");
    try {
      if (role) await this.admin.query(`set local role ${role}`);
      // What PostgREST does for a verified JWT: expose its claims to auth.uid().
      if (options.userId) await this.admin.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: options.userId, role: role ?? "authenticated" })]);
      let n = 0;
      const query = (async (text: string, params: unknown[] = []) => (await this.admin.query(text, params)).rows) as Query;
      query.expectError = async (text, params = []) => {
        const savepoint = `sp_${++n}`;
        await this.admin.query(`savepoint ${savepoint}`);
        try {
          await this.admin.query(text, params);
        } catch (error) {
          await this.admin.query(`rollback to savepoint ${savepoint}`);
          const e = error as { message: string; code?: string };
          return { message: e.message, code: e.code };
        }
        await this.admin.query(`release savepoint ${savepoint}`);
        throw new Error(`expected an error but the statement succeeded: ${text}`);
      };
      const result = await fn(query);
      await this.admin.query(options.commit ? "commit" : "rollback");
      return result;
    } catch (error) {
      await this.admin.query("rollback");
      throw error;
    }
  }

  /** A transaction that is COMMITTED (needed to exercise deferred constraint triggers). */
  async commit<R>(fn: (q: Query) => Promise<R>): Promise<R> {
    await this.admin.query("begin");
    try {
      const query = (async (text: string, params: unknown[] = []) => (await this.admin.query(text, params)).rows) as Query;
      const result = await fn(query);
      await this.admin.query("commit");
      return result;
    } catch (error) {
      await this.admin.query("rollback");
      throw error;
    }
  }

  /** The SupabaseLike client the repositories use, running every query as `role` through RLS. */
  client(role: Role, options: { userId?: string } = {}): SupabaseLike {
    return new PgSupabase(this, role, options.userId);
  }

  async drop(): Promise<void> {
    await this.admin.end().catch(() => undefined);
    await this.root.query(`drop database if exists ${this.name} with (force)`).catch(() => undefined);
    await this.root.end().catch(() => undefined);
  }
}

// ── A PostgREST-shaped adapter over a real connection ───────────────────────────────────────
// Executes the same calls supabase-js would (rpc, from().select().in()/eq()/order()/range()/
// maybeSingle()) as the given database role, returning rows as JSON exactly like PostgREST
// (to_jsonb). It does NOT exercise the HTTP layer or supabase-js itself.

const SCALAR_RPCS = new Set(["catalogue_facets", "catalogue_filter_options", "admin_save_opportunity", "admin_save_organization", "admin_dashboard_stats", "admin_set_publication_status", "admin_set_verification", "admin_review_translation", "admin_delete_opportunity", "admin_delete_organization",
  "admin_save_source", "admin_mark_source_checked", "admin_delete_source", "admin_duplicate_index", "admin_import_batches", "admin_expire_opportunities", "admin_quality_report"]);
/** Admin functions that change data: the adapter COMMITS them (reads roll back). */
const WRITING_RPCS = /^admin_(save|set|review|delete|mark|expire)_/;
const ARG_TYPES: Record<string, string> = { p_filters: "jsonb", p_payload: "jsonb", p_now: "timestamptz", p_page: "integer", p_page_size: "integer", p_exclude_demo: "boolean", p_id: "uuid", p_status: "text", p_verified: "boolean", p_language: "text", p_at: "timestamptz", p_stale_days: "integer" };
const IDENT = /^[a-z_]+$/;

class PgSupabase implements SupabaseLike {
  constructor(private readonly db: TestDb, private readonly role: Role, private readonly userId?: string) {}

  rpc(fn: string, args: Record<string, unknown> = {}): PromiseLike<QueryResult> {
    if (!IDENT.test(fn)) throw new Error(`bad function name ${fn}`);
    const keys = Object.keys(args);
    const named = keys.map((k, i) => `${k} => $${i + 1}::${ARG_TYPES[k] ?? "text"}`).join(", ");
    const params = keys.map((k) => (ARG_TYPES[k] === "jsonb" ? JSON.stringify(args[k]) : args[k]));
    const sql = SCALAR_RPCS.has(fn) ? `select public.${fn}(${named}) as data` : `select to_jsonb(r) as data from public.${fn}(${named}) r`;
    return this.run(async (q) => {
      const rows = await q<{ data: unknown }>(sql, params);
      return SCALAR_RPCS.has(fn) ? rows[0]?.data : rows.map((r) => r.data);
    }, WRITING_RPCS.test(fn));
  }

  from(table: string) {
    if (!IDENT.test(table)) throw new Error(`bad table ${table}`);
    return {
      select: (columns: string) => new PgSelect(this, table, columns),
      upsert: (values: Record<string, unknown>, options?: { onConflict?: string; ignoreDuplicates?: boolean }) => this.upsert(table, values, options?.onConflict ?? "id", options?.ignoreDuplicates ?? false),
      update: (values: Record<string, unknown>) => new PgMutation(this, table, "update", values),
      delete: () => new PgMutation(this, table, "delete"),
    };
  }

  /** INSERT … ON CONFLICT DO UPDATE, like PostgREST's upsert: columns and types come from the JSON body. */
  private upsert(table: string, values: Record<string, unknown>, onConflict: string, ignoreDuplicates: boolean): PromiseLike<QueryResult> {
    const cols = Object.keys(values);
    const targets = onConflict.split(",");
    for (const c of [...cols, ...targets]) if (!IDENT.test(c)) throw new Error(`bad column ${c}`);
    const action = ignoreDuplicates ? "do nothing" : `do update set ${cols.filter((c) => !targets.includes(c)).map((c) => `${c} = excluded.${c}`).join(", ")}`;
    const sql = `insert into public.${table} (${cols.join(", ")}) select ${cols.join(", ")} from jsonb_populate_record(null::public.${table}, $1::jsonb) on conflict (${targets.join(", ")}) ${action}`;
    return this.run(async (q) => { await q(sql, [JSON.stringify(values)]); return null; }, true);
  }

  /** Reads roll back (nothing changes); writes COMMIT so the next call sees them. */
  run(fn: (q: Query) => Promise<unknown>, commit = false): PromiseLike<QueryResult> {
    return this.db
      .tx(this.role, fn, { userId: this.userId, commit })
      .then((data) => ({ data, error: null }) as QueryResult)
      .catch((e: { message: string; code?: string }) => ({ data: null, error: { message: e.message, code: e.code } }) as QueryResult);
  }
}

/** update()/delete() with chained .eq() filters, executed (and committed) when awaited. */
class PgMutation implements MutationQuery {
  private filters: { column: string; value: string }[] = [];
  constructor(private readonly client: PgSupabase, private readonly table: string, private readonly kind: "update" | "delete", private readonly values: Record<string, unknown> = {}) {}

  eq(column: string, value: string) { this.filters.push({ column, value }); return this; }

  private execute(): PromiseLike<QueryResult> {
    const cols = Object.keys(this.values);
    for (const c of [...cols, ...this.filters.map((f) => f.column)]) if (!IDENT.test(c)) throw new Error(`bad column ${c}`);
    const params: unknown[] = [];
    let sql: string;
    if (this.kind === "update") {
      params.push(JSON.stringify(this.values));
      sql = `update public.${this.table} t set ${cols.map((c) => `${c} = r.${c}`).join(", ")} from jsonb_populate_record(null::public.${this.table}, $1::jsonb) r`;
    } else sql = `delete from public.${this.table} t`;
    const where = this.filters.map((f) => { params.push(f.value); return `t.${f.column}::text = $${params.length}::text`; });
    sql += where.length ? ` where ${where.join(" and ")}` : "";
    return this.client.run(async (q) => { await q(sql, params); return null; }, true);
  }

  then<R1 = QueryResult, R2 = never>(ok?: ((v: QueryResult) => R1 | PromiseLike<R1>) | null, err?: ((r: unknown) => R2 | PromiseLike<R2>) | null) {
    return this.execute().then(ok, err);
  }
}

class PgSelect implements SelectQuery {
  private filters: { column: string; kind: "eq" | "in"; value: unknown }[] = [];
  private ordering: { column: string; asc: boolean }[] = [];
  private window: [number, number] | null = null;

  constructor(private readonly client: PgSupabase, private readonly table: string, private readonly columns: string) {}

  in(column: string, values: readonly string[]) { this.filters.push({ column, kind: "in", value: [...values] }); return this; }
  eq(column: string, value: string | boolean) { this.filters.push({ column, kind: "eq", value }); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.ordering.push({ column, asc: options?.ascending ?? true }); return this; }
  range(from: number, to: number) { this.window = [from, to]; return this; }

  private execute(limit?: number): PromiseLike<QueryResult> {
    const cols = this.columns.split(",").map((c) => c.trim());
    for (const c of [...cols, ...this.filters.map((f) => f.column), ...this.ordering.map((o) => o.column)]) if (c !== "*" && !IDENT.test(c)) throw new Error(`bad column ${c}`);
    const params: unknown[] = [];
    const where = this.filters.map((f) => {
      params.push(f.value);
      return f.kind === "in" ? `${f.column}::text = any($${params.length}::text[])` : `${f.column}::text = $${params.length}::text`;
    });
    const order = this.ordering.length ? ` order by ${this.ordering.map((o) => `${o.column} ${o.asc ? "asc" : "desc"}`).join(", ")}` : "";
    const range = this.window ? ` limit ${this.window[1] - this.window[0] + 1} offset ${this.window[0]}` : limit ? ` limit ${limit}` : "";
    const sql = `select to_jsonb(t) as data from (select ${cols.join(", ")} from public.${this.table}${where.length ? ` where ${where.join(" and ")}` : ""}${order}${range}) t`;
    return this.client.run(async (q) => (await q<{ data: unknown }>(sql, params)).map((r) => r.data));
  }

  then<R1 = QueryResult, R2 = never>(ok?: ((v: QueryResult) => R1 | PromiseLike<R1>) | null, err?: ((r: unknown) => R2 | PromiseLike<R2>) | null) {
    return this.execute().then(ok, err);
  }

  maybeSingle(): PromiseLike<QueryResult> {
    return this.execute(2).then((r) => {
      if (r.error) return r;
      const rows = (r.data ?? []) as unknown[];
      if (rows.length > 1) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
      return { data: rows[0] ?? null, error: null };
    });
  }
}

/** The first row, or a clear failure (strict index access). */
export function first<T>(rows: T[]): T {
  if (rows[0] === undefined) throw new Error("expected at least one row");
  return rows[0];
}

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────

let counter = 0;
const lit = (v: unknown) => (v === null || v === undefined ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** Inserts a minimal valid organization; returns its id. */
export async function insertOrganization(q: Query, overrides: Record<string, unknown> = {}): Promise<string> {
  const n = ++counter;
  const row = { slug: `org-${n}`, kind: "university", name: `Org ${n}`, country: "AZ", website_url: "https://org.example.com", is_demo: false, ...overrides };
  const keys = Object.keys(row);
  const rows = await q<{ id: string }>(`insert into public.organizations (${keys.join(",")}) values (${keys.map((k) => lit((row as Record<string, unknown>)[k])).join(",")}) returning id`);
  return rows[0]!.id;
}

/**
 * Inserts a valid, published, VERIFIED opportunity plus its Azerbaijani original translation.
 * Must run inside ONE transaction (deferred constraint triggers are checked at COMMIT).
 */
export async function insertOpportunity(
  q: Query,
  overrides: Record<string, unknown> = {},
  options: { organizationId?: string; translations?: Record<string, unknown>[] | false } = {},
): Promise<string> {
  const n = ++counter;
  const organizationId = options.organizationId ?? (await insertOrganization(q));
  const row: Record<string, unknown> = {
    slug: `opp-${n}`, organization_id: organizationId, opportunity_type: "scholarship", location_type: "onsite", country: "AZ", city_id: "baku",
    funding_type: "fully_funded", application_url: "https://org.example.com/apply", official_source_url: "https://org.example.com/program",
    deadline_type: "fixed", application_deadline: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    publication_status: "published", verification_status: "verified", last_verified_at: new Date().toISOString(),
    verified_by: "00000000-0000-4000-8000-000000000001", original_language: "az", ...overrides,
  };
  const keys = Object.keys(row);
  const id = (await q<{ id: string }>(`insert into public.opportunities (${keys.join(",")}) values (${keys.map((k) => lit(row[k])).join(",")}) returning id`))[0]!.id;
  if (options.translations !== false) {
    for (const t of options.translations ?? [{ language: "az", status: "original", title: `Başlıq ${n}`, short_description: "Qısa təsvir" }]) {
      const tr: Record<string, unknown> = { opportunity_id: id, ...t };
      const tk = Object.keys(tr);
      await q(`insert into public.opportunity_translations (${tk.join(",")}) values (${tk.map((k) => lit(tr[k])).join(",")})`);
    }
  }
  return id;
}
