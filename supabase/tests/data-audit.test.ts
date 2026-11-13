import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDemoRecords } from "@/features/opportunities/demo-data";
import { findDuplicates, type DuplicateIndexEntry } from "@/lib/import/duplicates";
import { getApplicationState } from "@/lib/opportunities/deadline";
import { resolveContent } from "@/lib/opportunities/translations";
import { TestDb } from "./helpers";

/**
 * DATA AUDIT (QA phase): invariants of the content itself, checked against the real schema with the
 * real seed. These are the properties a visitor relies on: demo is never passed off as real, nothing
 * published lacks an official source, a passed deadline is never shown as open, the seed has no
 * duplicates, and translations never carry facts.
 */
describe("data audit (demo seed on the real schema)", () => {
  let db: TestDb;
  const records = getDemoRecords();
  beforeAll(async () => { db = await TestDb.create({ seed: true }); });
  afterAll(async () => { await db?.drop(); });

  it("every seeded record is flagged as demo, and none is verified", async () => {
    const [row] = await db.sql<{ total: string; real: string; verified: string }>(
      "select count(*) total, count(*) filter (where not is_demo) real, count(*) filter (where verification_status = 'verified') verified from public.opportunities",
    );
    expect(Number(row!.total)).toBe(records.length);
    expect(Number(row!.real)).toBe(0);
    expect(Number(row!.verified)).toBe(0);
  });

  it("no published record lacks an official source, and the database refuses one", async () => {
    const [row] = await db.sql<{ n: string }>("select count(*) n from public.opportunities where publication_status = 'published' and official_source_url is null");
    expect(Number(row!.n)).toBe(0);
    await db.tx(null, async (q) => {
      const message = (await q.expectError("update public.opportunities set official_source_url = null where id = (select id from public.opportunities where publication_status = 'published' limit 1)")).message;
      expect(message).toMatch(/opportunities_published_requirements/);
    });
  });

  it("every official source is https (no javascript:, http:, credentials or whitespace)", async () => {
    const rows = await db.sql<{ slug: string }>("select slug from public.opportunities where official_source_url !~ '^https://[^\\s@]+$' or application_url !~ '^https://[^\\s@]+$'");
    expect(rows).toEqual([]);
  });

  it("a record whose deadline has passed is never shown as open, whatever its stored status", () => {
    const later = new Date(Date.now() + 400 * 86_400_000);
    for (const o of records) {
      if (o.deadlineType !== "fixed" || !o.applicationDeadline) continue;
      expect(["expired"], `${o.slug} one year after its deadline`).toContain(getApplicationState(o, later));
    }
    expect(records.some((o) => getApplicationState(o) === "expired")).toBe(true); // the seed contains expired examples
  });

  it("the demo seed has no duplicates (same URL, same slug, or a very similar title in one organization)", () => {
    const index: DuplicateIndexEntry[] = records.map((o) => ({
      id: o.id, slug: o.slug, organizationId: o.organization.id, officialSourceUrl: o.officialSourceUrl,
      applicationDeadline: o.applicationDeadline, status: o.verificationStatus, titles: o.translations.map((t) => t.title),
    }));
    const clashes = records.flatMap((o) =>
      findDuplicates({ slug: o.slug, organizationId: o.organization.id, officialSourceUrl: o.officialSourceUrl, applicationDeadline: o.applicationDeadline, titles: o.translations.map((t) => t.title) },
        index.filter((e) => e.id !== o.id), { ignoreSlug: false }).map((m) => `${o.slug} ~ ${m.slug} (${m.reason})`),
    );
    expect(clashes).toEqual([]);
  });

  it("every record has exactly one original translation, in its original language", async () => {
    const rows = await db.sql<{ slug: string; originals: string; matches: string }>(
      `select o.slug, count(*) filter (where t.status = 'original') originals,
              count(*) filter (where t.status = 'original' and t.language = o.original_language) matches
         from public.opportunities o left join public.opportunity_translations t on t.opportunity_id = o.id group by o.id`,
    );
    for (const r of rows) {
      expect(Number(r.originals), r.slug).toBe(1);
      expect(Number(r.matches), r.slug).toBe(1);
    }
  });

  it("translations carry text only: no fact column exists on the translation table", async () => {
    const cols = (await db.sql<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'opportunity_translations'")).map((c) => c.column_name);
    const facts = ["application_deadline", "official_source_url", "application_url", "funding_amount", "funding_type", "eligible_countries", "education_levels", "country", "city", "organization_id"];
    expect(cols.filter((c) => facts.includes(c))).toEqual([]);
  });

  it("locale resolution can only ever produce text: the resolved content has no fact fields", () => {
    const o = records[0]!;
    for (const l of ["az", "ru", "en"] as const) {
      const keys = Object.keys(resolveContent(o, l)).sort();
      expect(keys.filter((k) => /deadline|url|amount|fund|country|city|level|eligible/i.test(k)), l).toEqual([]);
    }
    for (const o2 of records) for (const l of ["az", "ru", "en"] as const) expect(resolveContent(o2, l).title.value.length, `${o2.slug}/${l}`).toBeGreaterThan(0);
  });

  it("anonymous visitors cannot read machine drafts, unpublished or private data", async () => {
    await db.sql("update public.opportunity_translations set status = 'machine_draft' where ctid = (select ctid from public.opportunity_translations where status <> 'original' limit 1)");
    const [hidden] = await db.sql<{ id: string; language: string }>("select opportunity_id id, language from public.opportunity_translations where status = 'machine_draft' limit 1");
    await db.tx("anon", async (q) => {
      expect(await q("select 1 from public.opportunity_translations where opportunity_id = $1 and language = $2", [hidden!.id, hidden!.language])).toEqual([]);
      await q.expectError("select * from public.opportunity_sources");
      await q.expectError("select * from public.user_roles");
      await q.expectError("select * from public.admin_audit_log");
    });
  });

  it("anonymous visitors see only published demo/verified records", async () => {
    await db.tx("anon", async (q) => {
      const rows = await q<{ n: string }>("select count(*) n from public.opportunities where publication_status <> 'published'");
      expect(Number(rows[0]!.n)).toBe(0);
    });
  });
});
