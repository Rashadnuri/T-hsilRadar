import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleSetStatus, handleSetVerification, type AdminContext } from "@/features/admin/handlers";
import { handleExpireCheck, handleImportCommit, handleImportPreview, handleSaveSource, handleMarkSourceChecked } from "@/features/admin/import-handlers";
import { ALL_COLUMNS } from "@/lib/import/columns";
import { csvCell } from "@/lib/import/csv";
import type { AuthGateway } from "@/lib/auth/types";
import { SupabaseAdminRepository, SupabaseRoleRepository } from "@/repositories/admin/supabase-admin-repository";
import { databaseAvailable, insertOrganization, TestDb } from "./helpers";

const available = await databaseAvailable();
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
};
const row = (v: Record<string, string>) => ALL_COLUMNS.map((c) => csvCell(v[c] ?? "")).join(",");
const file = (...rows: Record<string, string>[]) => [ALL_COLUMNS.join(","), ...rows.map(row)].join("\r\n");

/** The whole import workflow against REAL PostgreSQL under row level security. */
describe.skipIf(!available)("CSV import workflow on PostgreSQL", () => {
  let db: TestDb;
  const ctxFor = (id: string): AdminContext & { repo: SupabaseAdminRepository } => {
    const client = db.client("authenticated", { userId: id });
    const roles = new SupabaseRoleRepository(client);
    const repo = new SupabaseAdminRepository(client);
    const auth = { getUser: async () => ({ id, email: "x@example.com", fullName: null, emailConfirmed: true }) } as unknown as AuthGateway;
    return { auth, roles, admin: repo, repo };
  };
  const good = (over: Record<string, string> = {}) => ({
    organization: "import-org", opportunity_type: "scholarship", location_type: "onsite", country: "DE", official_source_url: "https://www.import-university.org/programs/one",
    deadline_type: "fixed", deadline: "2099-06-30", deadline_timezone: "Europe/Berlin", original_language: "en", education_levels: "master|phd",
    title_en: "Imported scholarship", short_en: "Short text from the official page.", title_az: "İdxal təqaüdü", short_az: "qısa", ...over,
  });

  beforeAll(async () => {
    db = await TestDb.create();
    await db.sql(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.com'), ('${USER}', 'user@example.com')`);
    await db.sql(`insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin')`);
    await db.tx(null, async (q) => { await insertOrganization(q, { slug: "import-org", name: "Import University" }); }, { commit: true });
  });
  afterAll(async () => { await db?.drop(); });

  it("a regular user can neither preview nor import", async () => {
    const ctx = ctxFor(USER);
    expect(await handleImportPreview(file(good()), ctx)).toEqual({ ok: false, code: "forbidden" });
    expect(await handleImportCommit(file(good()), {}, ctx)).toEqual({ ok: false, code: "forbidden" });
    expect(await db.sql("select 1 from public.opportunities where import_batch is not null")).toHaveLength(0);
  });

  it("preview → commit: drafts with provenance, hidden machine-draft translations, duplicates skipped on re-import", async () => {
    const { repo, ...ctx } = ctxFor(ADMIN);
    const source = await handleSaveSource(form({ organizationName: "Import University", websiteUrl: "https://www.import-university.org", sourceType: "university", country: "DE", accessMethod: "official_website", isActive: "on" }), ctx as AdminContext);
    expect(source.ok).toBe(true);

    const csv = file(good(), good({ title_en: "Broken row", opportunity_type: "nonsense", official_source_url: "https://www.import-university.org/programs/two" }), good({ title_en: "Reviewed", title_az: "Yoxlanılmış proqram", official_source_url: "https://www.import-university.org/programs/three", translations_reviewed: "yes" }));
    const preview = await handleImportPreview(csv, ctx as AdminContext);
    expect(preview.ok && preview.preview.rows.map((r) => r.status)).toEqual(["warning", "error", "warning"]);
    expect((await db.sql("select 1 from public.opportunities where import_batch is not null")).length).toBe(0); // nothing saved by a preview

    const res = await handleImportCommit(csv, {}, ctx as AdminContext);
    expect(res).toMatchObject({ ok: true, created: 2, skipped: 1, failed: 0 });
    if (!res.ok) return;
    const rows = await db.sql<{ publication_status: string; verification_status: string; import_batch: string; source_id: string; verified_by: string | null; application_deadline: string }>(
      "select publication_status::text, verification_status::text, import_batch, source_id, verified_by, application_deadline from public.opportunities where import_batch is not null order by slug");
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ publication_status: "draft", verification_status: "unverified", import_batch: res.batch, verified_by: null });
    expect(rows.every((r) => r.source_id === (source as { id: string }).id)).toBe(true);
    const translations = await db.sql<{ title: string; language: string; status: string }>("select t.title, t.language, t.status::text from public.opportunity_translations t join public.opportunities o on o.id = t.opportunity_id where o.import_batch is not null order by t.title, t.language");
    expect(translations.find((t) => t.title === "İdxal təqaüdü")).toMatchObject({ language: "az", status: "machine_draft" });
    expect(translations.some((t) => t.language === "az" && t.status === "human")).toBe(true); // the "reviewed" row
    // the public cannot see drafts (or machine drafts)
    await db.tx("anon", async (q) => { expect(await q("select 1 from public.opportunities where slug like 'imported-%' or slug like 'reviewed%'")).toHaveLength(0); });

    // importing the same file again: everything is a duplicate now
    expect(await handleImportCommit(csv, {}, ctx as AdminContext)).toMatchObject({ ok: true, created: 0, skipped: 3 });
    expect((await repo.importBatches())[0]).toMatchObject({ batch: res.batch, total: 2, draft: 2, published: 0 });
    expect((await repo.list({ batch: res.batch, page: 1 })).total).toBe(2);
    const ids = (await repo.list({ imported: true, page: 1 })).items.map((r) => r.id);
    expect(Object.values(await repo.importInfo(ids)).every((i) => i.importBatch === res.batch)).toBe(true);
  });

  it("the file cannot publish: it still needs verification and review, and passed deadlines can never be published", async () => {
    const { repo, ...rest } = ctxFor(ADMIN);
    const ctx = rest as AdminContext;
    const res = await handleImportCommit(file(good({ title_en: "Past deadline", title_az: "Keçmiş son tarix", official_source_url: "https://www.import-university.org/programs/past", deadline: "2020-05-01" }), good({ title_en: "Future one", title_az: "Gələcək imkan", official_source_url: "https://www.import-university.org/programs/future" })), {}, ctx);
    if (!res.ok) throw new Error("commit failed");
    const [past, future] = res.results.map((r) => r.id!);
    await handleSetVerification(past!, true, ctx);
    await handleSetStatus(past!, "in_review", ctx);
    expect(await handleSetStatus(past!, "published", ctx)).toMatchObject({ ok: false, blockers: expect.arrayContaining(["already_expired"]) });
    // the future one follows the normal workflow
    expect(await handleSetStatus(future!, "in_review", ctx)).toMatchObject({ ok: true });
    expect(await handleSetStatus(future!, "published", ctx)).toMatchObject({ ok: false, blockers: ["not_verified"] });
    await handleSetVerification(future!, true, ctx);
    expect(await handleSetStatus(future!, "published", ctx)).toEqual({ ok: true, status: "published" });
    expect(repo).toBeTruthy();
  });

  it("expiry detection flags verified opportunities with a passed deadline; quality report and source overdue", async () => {
    const { repo, ...rest } = ctxFor(ADMIN);
    const ctx = rest as AdminContext;
    // the "past deadline" record above is verified with a passed deadline
    const before = await repo.qualityReport();
    expect(before.expiredUnflagged.length).toBeGreaterThanOrEqual(1);
    const flagged = await handleExpireCheck(ctx);
    expect(flagged.ok && flagged.flagged).toBeGreaterThanOrEqual(1);
    expect((await repo.qualityReport()).expiredUnflagged).toEqual([]);
    expect(await handleExpireCheck(ctx)).toEqual({ ok: true, flagged: 0 });
    // the source was never checked
    const sources = await repo.listSources();
    expect((await repo.qualityReport()).sourcesOverdue).toContain(sources[0]!.id);
    await handleMarkSourceChecked(sources[0]!.id, ctx);
    expect((await repo.qualityReport()).sourcesOverdue).not.toContain(sources[0]!.id);
    expect((await repo.listSources())[0]!.lastCheckedAt).not.toBeNull();
  });
});
