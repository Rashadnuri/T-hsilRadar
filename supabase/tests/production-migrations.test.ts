import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./helpers";

/**
 * PRODUCTION MIGRATION CHECKS. `supabase db push` applies each file in its own transaction to a
 * hosted project, in filename order, and never runs seed.sql. These tests assert that the migrations
 * are safe under exactly those conditions: ordered, self-contained, free of demo content, and
 * using only extensions a hosted Supabase project offers.
 */
const DIR = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR).sort();
const sql = (f: string) => readFileSync(join(DIR, f), "utf8");
/** The statements outside function bodies ($$ … $$): what actually runs at migration time. */
const topLevel = (text: string) => text.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "");

describe("migration files", () => {
  it("are .sql files named <14-digit timestamp>_<name>.sql, unique and strictly increasing", () => {
    expect(files.length).toBeGreaterThanOrEqual(14);
    for (const f of files) expect(f, f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    const stamps = files.map((f) => f.slice(0, 14));
    expect(new Set(stamps).size).toBe(stamps.length);
    expect([...stamps].sort()).toEqual(stamps);
  });

  it("do not manage their own transaction (the CLI wraps each file)", () => {
    for (const f of files) expect(topLevel(sql(f)), f).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("never insert demo or content rows at migration time (function bodies excepted)", () => {
    for (const f of files) expect(topLevel(sql(f)), f).not.toMatch(/insert\s+into\s+public\.(opportunities|organizations|opportunity_translations|profiles|user_roles|opportunity_sources)\b/i);
  });

  it("never grant a role or create an admin", () => {
    for (const f of files) expect(topLevel(sql(f)), f).not.toMatch(/insert\s+into\s+public\.user_roles/i);
  });

  it("create only extensions that hosted Supabase provides, in the `extensions` schema", () => {
    const created = files.flatMap((f) => [...topLevel(sql(f)).matchAll(/create\s+extension\s+(?:if\s+not\s+exists\s+)?"?([a-z_-]+)"?(?:\s+with)?\s+schema\s+(\w+)/gi)].map((m) => `${m[1]}@${m[2]}`));
    expect(created.sort()).toEqual(["pg_trgm@extensions", "unaccent@extensions"]);
  });

  it("keep seed.sql out of the migrations directory", () => {
    expect(files.some((f) => /seed/i.test(f))).toBe(false);
  });
});

describe("a production database right after the migrations", () => {
  let db: TestDb;
  beforeAll(async () => { db = await TestDb.create({ seed: false }); });
  afterAll(async () => { await db?.drop(); });

  it("contains reference data only: every content, user and audit table is empty", async () => {
    const tables = (await db.sql<{ t: string }>("select table_name t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")).map((r) => r.t);
    const filled: string[] = [];
    for (const t of tables) if ((await db.sql<{ n: number }>(`select count(*)::int n from public.${t}`))[0]!.n > 0) filled.push(t);
    expect(filled).toEqual(["categories", "cities"]); // taxonomy + Azerbaijani cities, nothing else
  });

  it("has no demo record and no admin", async () => {
    expect((await db.sql<{ n: number }>("select count(*)::int n from public.opportunities where is_demo"))[0]!.n).toBe(0);
    expect((await db.sql<{ n: number }>("select count(*)::int n from public.user_roles"))[0]!.n).toBe(0);
  });

  it("an anonymous visitor sees an empty catalogue, not an error", async () => {
    await db.tx("anon", async (q) => {
      expect(await q("select id from public.opportunities")).toEqual([]);
      expect((await q<{ n: number }>("select count(*)::int n from public.categories"))[0]!.n).toBeGreaterThan(0);
    });
  });
});
