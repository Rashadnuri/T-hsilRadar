import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleRegister } from "@/features/auth/handlers";
import { getDemoRecords } from "@/features/opportunities/demo-data";
import { createFakeAdmin, createFakeRoles } from "@/lib/auth/fake/admin";
import { createFakeAuth } from "@/lib/auth/fake/gateway";
import { fakeState } from "@/lib/auth/fake/store";
import type { CookieJar } from "@/lib/auth/types";
import { AdminRepositoryError } from "@/repositories/admin/types";
import { authorize, handleDeleteOpportunity, handleDeleteOrganization, handleReviewTranslation, handleSaveOpportunity, handleSaveOrganization, handleSetStatus, handleSetVerification, type AdminContext } from "./handlers";

const ORG = getDemoRecords()[0]!.organizationId;
const PW = "correct horse battery";

function jar(): CookieJar {
  const store = new Map<string, string>();
  return {
    getAll: () => [...store].map(([name, value]) => ({ name, value })),
    setAll: (cookies) => cookies.forEach(({ name, value, options }) => (options?.maxAge === 0 || value === "" ? store.delete(name) : store.set(name, value))),
  };
}
const form = (values: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  return f;
};

/** One browser: its own cookie jar, registered and signed in. */
async function browser(email: string): Promise<AdminContext & { userId: string }> {
  const { auth, profiles } = createFakeAuth(jar());
  await handleRegister(form({ fullName: "Test User", email, password: PW, confirmPassword: PW }), { auth, profiles, locale: "en", siteUrl: "https://tahsilradar.test" });
  const user = (await auth.getUser())!;
  return { auth, roles: createFakeRoles(), admin: createFakeAdmin(user.id), userId: user.id };
}
const valid = (extra: Record<string, string | string[]> = {}) => ({
  organizationId: ORG, opportunityType: "scholarship", locationType: "onsite", country: "DE", originalLanguage: "az", deadlineType: "rolling",
  officialSourceUrl: "https://org.example.com/program", t_az_title: "Admin test imkanı", t_az_short: "Qısa təsvir", ...extra,
});

let admin: Awaited<ReturnType<typeof browser>>;
let user: Awaited<ReturnType<typeof browser>>;

beforeAll(() => {
  process.env.FAKE_AUTH_MAILBOX_FILE = join(mkdtempSync(join(tmpdir(), "tr-admin-")), "mailbox.jsonl");
  writeFileSync(process.env.FAKE_AUTH_MAILBOX_FILE, "");
  process.env.FAKE_ADMIN_EMAILS = "boss@example.com";
});
beforeEach(async () => {
  for (const m of [fakeState.users, fakeState.idByEmail, fakeState.sessions, fakeState.codes, fakeState.failures, fakeState.profiles, fakeState.saved, fakeState.applications] as Map<unknown, unknown>[]) m.clear();
  (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("tahsilradar.fake-admin-store")] = undefined;
  admin = await browser("boss@example.com");
  user = await browser("regular@example.com");
});

const create = async (extra: Record<string, string | string[]> = {}) => {
  const r = await handleSaveOpportunity(form(valid(extra)), admin);
  if (!r.ok) throw new Error(`create failed: ${JSON.stringify(r)}`);
  return r.id;
};

describe("authorization (server-side, in every handler)", () => {
  it("only a signed-in user with the admin role passes", async () => {
    expect("error" in (await authorize(admin))).toBe(false);
    expect(await authorize(user)).toEqual({ error: "forbidden" });
    const anon = createFakeAuth(jar());
    expect(await authorize({ auth: anon.auth, roles: anon.roles, admin: createFakeAdmin("nobody") })).toEqual({ error: "unauthorized" });
  });
  it("fails closed when the role lookup fails or authentication/admin data is not configured", async () => {
    const broken = { ...admin, roles: { getRoles: async () => { throw new AdminRepositoryError("getRoles", "failed"); } } };
    expect(await authorize(broken)).toEqual({ error: "forbidden" });
    expect(await authorize({ ...admin, roles: null })).toEqual({ error: "forbidden" });
    expect(await authorize({ ...admin, admin: null })).toEqual({ error: "forbidden" });
  });
  it("a regular user is refused by EVERY handler and nothing changes", async () => {
    const id = await create();
    const before = JSON.stringify(await admin.admin!.get(id));
    const results = await Promise.all([
      handleSaveOpportunity(form(valid({ id, t_az_title: "Hacked" })), user),
      handleSaveOpportunity(form(valid()), user),
      handleSetStatus(id, "in_review", user),
      handleSetVerification(id, true, user),
      handleReviewTranslation(id, "en", "machine_approved", user),
      handleDeleteOpportunity(id, user),
      handleSaveOrganization(form({ name: "Evil Org", kind: "company" }), user),
      handleDeleteOrganization(ORG, user),
    ]);
    for (const r of results) expect(r).toEqual({ ok: false, code: "forbidden" });
    expect(JSON.stringify(await admin.admin!.get(id))).toBe(before);
    expect((await admin.admin!.listOrganizations()).some((o) => o.name === "Evil Org")).toBe(false);
  });
  it("an anonymous visitor is refused by every handler (unauthorized)", async () => {
    const anon = createFakeAuth(jar());
    const ctx: AdminContext = { auth: anon.auth, roles: anon.roles, admin: createFakeAdmin("x") };
    for (const r of [await handleSaveOpportunity(form(valid()), ctx), await handleSetStatus("abc", "published", ctx), await handleSetVerification("abc", true, ctx), await handleDeleteOpportunity("abc", ctx)]) {
      expect(r).toEqual({ ok: false, code: "unauthorized" });
    }
  });
  it("a user cannot make themselves admin through any input (roles come from the role store only)", async () => {
    const payloads: Record<string, string>[] = [{ role: "admin" }, { roles: "admin" }, { isAdmin: "true" }, { email: "boss@example.com" }];
    for (const payload of payloads) {
      await handleSaveOrganization(form({ name: "X", kind: "company", ...payload }), user);
    }
    expect(await authorize(user)).toEqual({ error: "forbidden" });
  });
});

describe("creating and editing opportunities", () => {
  it("creates an unverified DRAFT with its original translation", async () => {
    const id = await create();
    const record = (await admin.admin!.get(id))!;
    expect(record).toMatchObject({ publicationStatus: "draft", verificationStatus: "unverified", verifiedBy: null, isDemo: false, createdBy: admin.userId, originalLanguage: "az" });
    expect(record.translations).toEqual([expect.objectContaining({ language: "az", status: "original", title: "Admin test imkanı" })]);
  });
  it("cannot create a published/verified record through the form (the fields do not exist)", async () => {
    const id = await create({ publicationStatus: "published", verificationStatus: "verified", publication_status: "published" });
    expect(await admin.admin!.get(id)).toMatchObject({ publicationStatus: "draft", verificationStatus: "unverified" });
  });
  it("reports validation problems as codes and writes nothing", async () => {
    const count = (await admin.admin!.stats()).total;
    const r = await handleSaveOpportunity(form(valid({ officialSourceUrl: "http://insecure", t_az_title: "" })), admin);
    expect(r).toMatchObject({ ok: false, code: "invalid", fieldErrors: { officialSourceUrl: { code: "invalid_url" }, t_az_title: { code: "required" } } });
    expect((await admin.admin!.stats()).total).toBe(count);
  });
  it("refuses an unknown organization and a duplicate slug", async () => {
    expect(await handleSaveOpportunity(form(valid({ organizationId: "99999999-9999-4999-8999-999999999999" })), admin)).toMatchObject({ ok: false, code: "invalid" });
    await create({ slug: "same-slug" });
    expect(await handleSaveOpportunity(form(valid({ slug: "same-slug" })), admin)).toMatchObject({ ok: false, code: "conflict" });
  });
  it("manages partial translations; machine drafts stay drafts; the original is preserved", async () => {
    const id = await create({ t_en_title: "English title", t_ru_title: "Русский (машинный)", t_ru_status: "machine_draft" });
    let record = (await admin.admin!.get(id))!;
    expect(record.translations.map((t) => `${t.language}:${t.status}`).sort()).toEqual(["az:original", "en:human", "ru:machine_draft"]);
    // emptying the English section removes only that translation
    expect((await handleSaveOpportunity(form(valid({ id, t_ru_title: "Русский (машинный)", t_ru_status: "machine_draft" })), admin)).ok).toBe(true);
    record = (await admin.admin!.get(id))!;
    expect(record.translations.map((t) => t.language).sort()).toEqual(["az", "ru"]);
    expect(record.translations.find((t) => t.language === "az")!.status).toBe("original");
  });
  it("editing the original text outdates the human translations (and bumps the content version)", async () => {
    const id = await create({ t_en_title: "English title" });
    await handleSaveOpportunity(form(valid({ id, t_az_title: "Dəyişmiş başlıq", t_en_title: "English title" })), admin);
    const record = (await admin.admin!.get(id))!;
    expect(record.contentVersion).toBe(2);
    // the admin re-saved the English text in the same request, so it is current again
    expect(record.translations.find((t) => t.language === "en")!.sourceVersion).toBe(2);
    await handleSaveOpportunity(form(valid({ id, t_az_title: "Yenə dəyişmiş", t_en_title: "English title" })), admin);
    expect((await admin.admin!.get(id))!.contentVersion).toBe(3);
  });
  it("does not change the original language on edit", async () => {
    const id = await create();
    await handleSaveOpportunity(form(valid({ id, originalLanguage: "ru", t_ru_title: "x" })), admin);
    expect((await admin.admin!.get(id))!.originalLanguage).toBe("az");
  });
  it("editing a non-published, verified record's critical fact withdraws the verification", async () => {
    const id = await create();
    await handleSetVerification(id, true, admin);
    expect((await admin.admin!.get(id))!.verificationStatus).toBe("verified");
    const r = await handleSaveOpportunity(form(valid({ id, officialSourceUrl: "https://other.example.com/page" })), admin);
    expect(r).toMatchObject({ ok: true, unverified: true });
    expect((await admin.admin!.get(id))!).toMatchObject({ verificationStatus: "unverified", verifiedBy: null });
  });
  it("editing non-critical text keeps the verification", async () => {
    const id = await create();
    await handleSetVerification(id, true, admin);
    const r = await handleSaveOpportunity(form(valid({ id, t_az_title: "Başqa başlıq" })), admin);
    expect(r).toMatchObject({ ok: true, unverified: false });
    expect((await admin.admin!.get(id))!.verificationStatus).toBe("verified");
  });
  it("a PUBLISHED record cannot lose a publishing requirement or have verified facts changed silently", async () => {
    const id = await create();
    await handleSetVerification(id, true, admin);
    await handleSetStatus(id, "in_review", admin);
    expect((await handleSetStatus(id, "published", admin)).ok).toBe(true);
    expect(await handleSaveOpportunity(form(valid({ id, officialSourceUrl: "" })), admin)).toMatchObject({ ok: false, code: "publish_blocked", blockers: ["missing_official_source"] });
    expect(await handleSaveOpportunity(form(valid({ id, officialSourceUrl: "https://changed.example.com/x" })), admin)).toMatchObject({ ok: false, code: "critical_change_published", changed: ["officialSourceUrl"] });
    expect(await handleSaveOpportunity(form(valid({ id, t_az_title: "Safe edit" })), admin)).toMatchObject({ ok: true });
  });
  it("unknown ids", async () => {
    expect(await handleSaveOpportunity(form(valid({ id: "00000000-0000-4000-8000-000000000000" })), admin)).toMatchObject({ ok: false, code: "not_found" });
    expect(await handleSaveOpportunity(form(valid({ id: "../etc" })), admin)).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("publication status and the publishing requirements", () => {
  it("follows draft → in review → published → archived → draft, and review can reject", async () => {
    const id = await create();
    await handleSetVerification(id, true, admin);
    expect(await handleSetStatus(id, "in_review", admin)).toEqual({ ok: true, status: "in_review" });
    expect((await handleSetStatus(id, "rejected", admin)).ok).toBe(true);
    expect((await handleSetStatus(id, "in_review", admin)).ok).toBe(true);
    expect((await handleSetStatus(id, "published", admin)).ok).toBe(true);
    expect((await admin.admin!.get(id))!.publishedAt).not.toBeNull();
    expect((await handleSetStatus(id, "archived", admin)).ok).toBe(true);
    expect((await handleSetStatus(id, "draft", admin)).ok).toBe(true);
  });
  it("refuses illegal transitions and unknown statuses", async () => {
    const id = await create();
    expect(await handleSetStatus(id, "published", admin)).toEqual({ ok: false, code: "invalid_transition" }); // must be reviewed first
    expect(await handleSetStatus(id, "rejected", admin)).toEqual({ ok: false, code: "invalid_transition" });
    expect(await handleSetStatus(id, "unpublished", admin)).toEqual({ ok: false, code: "invalid" });
    expect(await handleSetStatus(id, "bogus", admin)).toEqual({ ok: false, code: "invalid" });
    expect(await handleSetStatus("00000000-0000-4000-8000-000000000000", "in_review", admin)).toEqual({ ok: false, code: "not_found" });
  });
  it("publishing lists every missing requirement", async () => {
    const id = await create({ officialSourceUrl: "", deadlineType: "unknown", locationType: "onsite", country: "DE" });
    // (the form needs a source only for publishing, so the draft can exist without one)
    await handleSetStatus(id, "in_review", admin);
    const r = await handleSetStatus(id, "published", admin);
    expect(r).toMatchObject({ ok: false, code: "publish_blocked" });
    expect(!r.ok && r.blockers).toEqual(expect.arrayContaining(["missing_official_source", "not_verified", "deadline_not_stated"]));
  });
  it("requires a country (unless remote), an organization, a title, a type and a deadline statement", async () => {
    const remote = await create({ locationType: "remote", country: "", t_az_title: "Remote one" });
    await handleSetVerification(remote, true, admin);
    await handleSetStatus(remote, "in_review", admin);
    expect((await handleSetStatus(remote, "published", admin)).ok).toBe(true); // remote: no country needed, rolling = explicit statement
    expect((await admin.admin!.get(remote))).toMatchObject({ country: null, deadlineType: "rolling" });
  });
  it("cannot publish an already expired opportunity", async () => {
    const id = await create({ deadlineType: "fixed", deadline: "2020-01-01T10:00" });
    await handleSetVerification(id, true, admin);
    await handleSetStatus(id, "in_review", admin);
    const r = await handleSetStatus(id, "published", admin);
    expect(!r.ok && r.blockers).toContain("already_expired");
  });
  it("unapproved machine translations do not satisfy anything and are not public (only reviewed ones are)", async () => {
    const id = await create({ t_ru_title: "Машинный", t_ru_status: "machine_draft" });
    expect((await admin.admin!.get(id))!.translations.find((t) => t.language === "ru")!.status).toBe("machine_draft");
    expect((await handleReviewTranslation(id, "ru", "machine_approved", admin)).ok).toBe(true);
    expect((await admin.admin!.get(id))!.translations.find((t) => t.language === "ru")!.status).toBe("machine_approved");
    expect(await handleReviewTranslation(id, "az", "machine_approved", admin)).toEqual({ ok: false, code: "not_found" }); // the original is untouchable
    expect(await handleReviewTranslation(id, "ru", "original", admin)).toEqual({ ok: false, code: "invalid" });
    expect(await handleReviewTranslation(id, "de", "human", admin)).toEqual({ ok: false, code: "not_found" });
  });
});

describe("verification", () => {
  it("verify records the admin and the time; it needs an official source", async () => {
    const id = await create();
    expect(await handleSetVerification(id, true, admin)).toEqual({ ok: true, verified: true });
    expect((await admin.admin!.get(id))!).toMatchObject({ verificationStatus: "verified", verifiedBy: admin.userId });
    expect((await admin.admin!.get(id))!.lastVerifiedAt).not.toBeNull();
    const noSource = await create({ officialSourceUrl: "", t_az_title: "No source" });
    expect(await handleSetVerification(noSource, true, admin)).toEqual({ ok: false, code: "missing_official_source" });
  });
  it("a published record must be unpublished before it is un-verified", async () => {
    const id = await create();
    await handleSetVerification(id, true, admin);
    await handleSetStatus(id, "in_review", admin);
    await handleSetStatus(id, "published", admin);
    expect(await handleSetVerification(id, false, admin)).toEqual({ ok: false, code: "unpublish_first" });
    await handleSetStatus(id, "draft", admin);
    expect(await handleSetVerification(id, false, admin)).toEqual({ ok: true, verified: false });
  });
});

describe("deleting", () => {
  it("only non-published records; archive first", async () => {
    const id = await create();
    await handleSetVerification(id, true, admin);
    await handleSetStatus(id, "in_review", admin);
    await handleSetStatus(id, "published", admin);
    expect(await handleDeleteOpportunity(id, admin)).toEqual({ ok: false, code: "archive_first" });
    await handleSetStatus(id, "archived", admin);
    expect(await handleDeleteOpportunity(id, admin)).toEqual({ ok: true });
    expect(await admin.admin!.get(id)).toBeNull();
    expect(await handleDeleteOpportunity(id, admin)).toEqual({ ok: false, code: "not_found" });
  });
});

describe("organizations", () => {
  const org = (extra: Record<string, string> = {}) => form({ name: "Fresh Org", kind: "ngo", country: "AZ", websiteUrl: "https://fresh.example.org", ...extra });
  it("creates, edits, refuses duplicate slugs, and refuses to delete an organization in use", async () => {
    const created = await handleSaveOrganization(org(), admin);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect((await handleSaveOrganization(org({ id: created.id, name: "Renamed Org" }), admin)).ok).toBe(true);
    expect((await admin.admin!.getOrganization(created.id))!).toMatchObject({ name: "Renamed Org", slug: "fresh-org" });
    expect(await handleSaveOrganization(org({ slug: "fresh-org" }), admin)).toMatchObject({ ok: false, code: "conflict" });
    expect(await handleSaveOrganization(org({ websiteUrl: "http://x" }), admin)).toMatchObject({ ok: false, code: "invalid", fieldErrors: { websiteUrl: { code: "invalid_url" } } });
    expect(await handleDeleteOrganization(ORG, admin)).toEqual({ ok: false, code: "in_use" });
    expect(await handleDeleteOrganization(created.id, admin)).toEqual({ ok: true });
    expect(await handleDeleteOrganization(created.id, admin)).toEqual({ ok: false, code: "not_found" });
  });
});
