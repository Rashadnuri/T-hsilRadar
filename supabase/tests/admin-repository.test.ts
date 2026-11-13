import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleDeleteOpportunity, handleSaveOpportunity, handleSaveOrganization, handleSetStatus, handleSetVerification, type AdminContext } from "@/features/admin/handlers";
import { SupabaseAdminRepository, SupabaseRoleRepository } from "@/repositories/admin/supabase-admin-repository";
import { AdminRepositoryError } from "@/repositories/admin/types";
import { parseOpportunityForm } from "@/validation/admin";
import type { AuthGateway } from "@/lib/auth/types";
import { databaseAvailable, insertOpportunity, insertOrganization, TestDb } from "./helpers";

const available = await databaseAvailable();
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const form = (values: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  return f;
};

/** The admin handlers + repository against REAL PostgreSQL under row level security, as an admin and as a regular user. */
describe.skipIf(!available)("admin repository and handlers on PostgreSQL", () => {
  let db: TestDb;
  let org: string;
  let seededId: string;
  const asUser = (id: string): { roles: SupabaseRoleRepository; admin: SupabaseAdminRepository; ctx: AdminContext } => {
    const client = db.client("authenticated", { userId: id });
    const roles = new SupabaseRoleRepository(client);
    const admin = new SupabaseAdminRepository(client);
    const auth = { getUser: async () => ({ id, email: "x@example.com", fullName: null, emailConfirmed: true }) } as unknown as AuthGateway;
    return { roles, admin, ctx: { auth, roles, admin } };
  };

  beforeAll(async () => {
    db = await TestDb.create();
    await db.sql(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.com'), ('${USER}', 'user@example.com')`);
    await db.sql(`insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin')`);
    await db.tx(null, async (q) => {
      org = await insertOrganization(q, { slug: "repo-org", name: "Repo Org" });
      seededId = await insertOpportunity(q, { slug: "seeded-draft", publication_status: "draft", verification_status: "unverified", verified_by: null, last_verified_at: null }, { organizationId: org });
    }, { commit: true });
  });
  afterAll(async () => { await db?.drop(); });

  const values = (extra: Record<string, string | string[]> = {}) => ({
    organizationId: org, opportunityType: "scholarship", locationType: "onsite", country: "DE", originalLanguage: "az", deadlineType: "rolling",
    officialSourceUrl: "https://org.example.com/program", t_az_title: "Real DB imkanı", t_az_short: "Qısa", ...extra,
  });

  it("roles: the admin has the admin role, the regular user none", async () => {
    expect(await asUser(ADMIN).roles.getRoles(ADMIN)).toEqual(["admin"]);
    expect(await asUser(USER).roles.getRoles(USER)).toEqual([]);
    expect(await asUser(USER).roles.getRoles(ADMIN)).toEqual([]); // cannot read someone else's role
  });

  it("a regular user's repository calls are refused or see nothing", async () => {
    const { admin } = asUser(USER);
    await expect(admin.stats()).rejects.toMatchObject({ name: "AdminRepositoryError", reason: "forbidden" });
    await expect(admin.list({ page: 1 })).rejects.toBeInstanceOf(AdminRepositoryError);
    const parsed = parseOpportunityForm(form(values()));
    if (!parsed.ok) throw new Error("fixture invalid");
    await expect(admin.save(parsed.value)).rejects.toMatchObject({ reason: "forbidden" });
    expect(await admin.get(seededId)).toBeNull(); // drafts are invisible
    await expect(admin.setVerification(seededId, true)).rejects.toMatchObject({ reason: "forbidden" });
    expect(await admin.listOrganizations()).toEqual([]);
  });

  it("the admin handlers refuse a regular user before touching the database", async () => {
    const { ctx } = asUser(USER);
    expect(await handleSaveOpportunity(form(values()), ctx)).toEqual({ ok: false, code: "forbidden" });
    expect(await handleSetStatus(seededId, "in_review", ctx)).toEqual({ ok: false, code: "forbidden" });
    expect((await db.sql<{ n: number }>("select count(*) as n from public.opportunities where slug = 'real-db-imkani'"))[0]!.n).toBe(0);
  });

  it("an admin runs the whole workflow: create → verify → review → publish → archive → delete", async () => {
    const { ctx, admin } = asUser(ADMIN);
    const created = await handleSaveOpportunity(form(values({ t_en_title: "Real DB opportunity", t_ru_title: "Машинный", t_ru_status: "machine_draft" })), ctx);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.id;
    let record = (await admin.get(id))!;
    expect(record).toMatchObject({ publicationStatus: "draft", verificationStatus: "unverified", createdBy: null /* hidden column */ });
    expect(record.translations.map((t) => `${t.language}:${t.status}`).sort()).toEqual(["az:original", "en:human", "ru:machine_draft"]);

    expect(await handleSetStatus(id, "in_review", ctx)).toMatchObject({ ok: true });
    const blocked = await handleSetStatus(id, "published", ctx);
    expect(blocked).toMatchObject({ ok: false, code: "publish_blocked", blockers: ["not_verified"] });

    expect(await handleSetVerification(id, true, ctx)).toEqual({ ok: true, verified: true });
    // The verifier is stored but not readable through the API: the admin record shows verification + date only.
    record = (await admin.get(id))!;
    expect(record.verificationStatus).toBe("verified");
    expect(record.lastVerifiedAt).not.toBeNull();
    expect((await db.sql<{ verified_by: string }>(`select verified_by from public.opportunities where id = '${id}'`))[0]!.verified_by).toBe(ADMIN);

    expect(await handleSetStatus(id, "published", ctx)).toEqual({ ok: true, status: "published" });
    await db.tx("anon", async (q) => {
      const seen = await q<{ language: string }>(`select language from public.opportunity_translations where opportunity_id = '${id}' order by language`);
      expect(seen.map((t) => t.language)).toEqual(["az", "en"]); // the machine draft is not public
    });
    expect(await handleDeleteOpportunity(id, ctx)).toEqual({ ok: false, code: "archive_first" });
    expect(await handleSetStatus(id, "archived", ctx)).toEqual({ ok: true, status: "archived" });
    expect(await handleDeleteOpportunity(id, ctx)).toEqual({ ok: true });
  });

  it("the stats, list filters and organizations work for an admin", async () => {
    const { admin } = asUser(ADMIN);
    const stats = await admin.stats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(Object.values(stats.byStatus).reduce((a, b) => a + (b ?? 0), 0)).toBe(stats.total);
    const drafts = await admin.list({ status: "draft", page: 1 });
    expect(drafts.items.every((r) => r.publicationStatus === "draft")).toBe(true);
    expect(drafts.items.map((r) => r.slug)).toContain("seeded-draft");
    expect((await admin.list({ q: "seeded", page: 1 })).total).toBeGreaterThanOrEqual(1);
    const orgs = await admin.listOrganizations();
    expect(orgs.find((o) => o.id === org)!.opportunityCount).toBeGreaterThanOrEqual(1);
  });

  it("organizations: create, edit; delete refused while in use (database foreign key)", async () => {
    const { ctx, admin } = asUser(ADMIN);
    const created = await handleSaveOrganization(form({ name: "Another Org", kind: "ngo", country: "AZ", websiteUrl: "https://another.example.org" }), ctx);
    expect(created.ok).toBe(true);
    await expect(admin.removeOrganization(org)).rejects.toMatchObject({ reason: "in_use" });
    expect(await handleSaveOrganization(form({ name: "Dup", kind: "ngo", slug: "another-org" }), ctx)).toMatchObject({ ok: false, code: "conflict" });
  });

  it("deleting: non-published only", async () => {
    const { ctx, admin } = asUser(ADMIN);
    expect(await handleDeleteOpportunity(seededId, ctx)).toEqual({ ok: true });
    expect(await admin.get(seededId)).toBeNull();
  });

  it("repository errors carry no row data", async () => {
    const { admin } = asUser(ADMIN);
    try {
      await admin.setPublicationStatus(seededId, "draft"); // gone now → not found
    } catch (error) {
      expect(String((error as Error).message)).not.toMatch(/seeded|Real DB|official source/i);
    }
  });
});
