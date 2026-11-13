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
import { ALL_COLUMNS } from "@/lib/import/columns";
import { csvCell } from "@/lib/import/csv";
import { handleSaveOpportunity, handleSetStatus, handleSetVerification, type AdminContext } from "./handlers";
import { handleDeleteSource, handleExpireCheck, handleImportCommit, handleImportPreview, handleMarkSourceChecked, handleSaveSource } from "./import-handlers";

const demo = getDemoRecords()[1]!; // an Azerbaijani-organization demo record
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
async function browser(email: string): Promise<AdminContext & { userId: string }> {
  const { auth, profiles } = createFakeAuth(jar());
  await handleRegister(form({ fullName: "Test User", email, password: PW, confirmPassword: PW }), { auth, profiles, locale: "en", siteUrl: "https://tahsilradar.test" });
  const user = (await auth.getUser())!;
  return { auth, roles: createFakeRoles(), admin: createFakeAdmin(user.id), userId: user.id };
}

let admin: Awaited<ReturnType<typeof browser>>;
let user: Awaited<ReturnType<typeof browser>>;

beforeAll(() => {
  process.env.FAKE_AUTH_MAILBOX_FILE = join(mkdtempSync(join(tmpdir(), "tr-import-")), "mailbox.jsonl");
  writeFileSync(process.env.FAKE_AUTH_MAILBOX_FILE, "");
  process.env.FAKE_ADMIN_EMAILS = "boss@example.com";
});
beforeEach(async () => {
  for (const m of [fakeState.users, fakeState.idByEmail, fakeState.sessions, fakeState.codes, fakeState.failures, fakeState.profiles, fakeState.saved, fakeState.applications] as Map<unknown, unknown>[]) m.clear();
  (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("tahsilradar.fake-admin-store")] = undefined;
  admin = await browser("boss@example.com");
  user = await browser("regular@example.com");
});

const HEADER = ALL_COLUMNS.join(",");
const row = (v: Record<string, string>) => ALL_COLUMNS.map((c) => csvCell(v[c] ?? "")).join(",");
const good = (over: Record<string, string> = {}) => ({
  organization: demo.organization.slug, opportunity_type: "scholarship", location_type: "onsite", country: "DE", official_source_url: "https://official.test-university.org/p/one",
  deadline_type: "rolling", original_language: "en", title_en: "Imported opportunity one", short_en: "Short text copied from the official page.", ...over,
});
const file = (...rows: Record<string, string>[]) => [HEADER, ...rows.map(row)].join("\r\n");

describe("authorization", () => {
  it("every import / source / quality handler refuses a regular user and an anonymous visitor", async () => {
    const csv = file(good());
    const anon = createFakeAuth(jar());
    const anonCtx: AdminContext = { auth: anon.auth, roles: anon.roles, admin: createFakeAdmin("x") };
    for (const [ctx, code] of [[user, "forbidden"], [anonCtx, "unauthorized"]] as const) {
      expect(await handleImportPreview(csv, ctx)).toEqual({ ok: false, code });
      expect(await handleImportCommit(csv, {}, ctx)).toEqual({ ok: false, code });
      expect(await handleSaveSource(form({ organizationName: "X", websiteUrl: "https://x.example.org", sourceType: "ngo" }), ctx)).toMatchObject({ ok: false, code });
      expect(await handleMarkSourceChecked("abc", ctx)).toMatchObject({ ok: false, code });
      expect(await handleDeleteSource("abc", ctx)).toMatchObject({ ok: false, code });
      expect(await handleExpireCheck(ctx)).toEqual({ ok: false, code });
    }
    expect((await admin.admin!.stats()).total).toBe(getDemoRecords().length); // nothing was imported
  });
});

describe("source management", () => {
  const src = (extra: Record<string, string> = {}) => form({ organizationName: "Ministry of Education", websiteUrl: "https://edu.gov.az", sourceType: "government", country: "az", accessMethod: "official_website", notes: "Weekly check", isActive: "on", ...extra });
  it("creates, edits, marks as checked by a person, deactivates and deletes a source", async () => {
    const created = await handleSaveSource(src(), admin);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    let [s] = await admin.admin!.listSources();
    expect(s).toMatchObject({ organizationName: "Ministry of Education", sourceType: "government", country: "AZ", accessMethod: "official_website", isActive: true, lastCheckedAt: null });
    expect((await handleMarkSourceChecked(created.id, admin)).ok).toBe(true);
    expect((await admin.admin!.listSources())[0]!.lastCheckedAt).not.toBeNull();
    expect((await handleSaveSource(src({ id: created.id, isActive: "", notes: "Paused" }) , admin)).ok).toBe(true);
    [s] = await admin.admin!.listSources();
    expect(s).toMatchObject({ isActive: false, notes: "Paused" });
    expect(s!.lastCheckedAt).not.toBeNull(); // editing never resets the check date
    expect(await handleDeleteSource(created.id, admin)).toEqual({ ok: true });
    expect(await handleDeleteSource(created.id, admin)).toMatchObject({ ok: false, code: "not_found" });
  });
  it("validates: https, required fields, kind, country; refuses a second source with the same website", async () => {
    expect(await handleSaveSource(src({ websiteUrl: "http://edu.gov.az" }), admin)).toMatchObject({ ok: false, code: "invalid", fieldErrors: { websiteUrl: { code: "invalid_url" } } });
    expect(await handleSaveSource(src({ organizationName: "", sourceType: "club", country: "QQ" }), admin)).toMatchObject({ ok: false, fieldErrors: { organizationName: { code: "required" }, sourceType: { code: "invalid_choice" }, country: { code: "invalid_country" } } });
    expect((await handleSaveSource(src(), admin)).ok).toBe(true);
    expect(await handleSaveSource(src(), admin)).toMatchObject({ ok: false, code: "conflict" });
  });
  it("covers every organization category the platform supports", async () => {
    const kinds = ["government", "university", "bank", "it_company", "company", "ngo", "international_org", "scholarship_org", "development_org"];
    for (const [i, kind] of kinds.entries()) expect((await handleSaveSource(src({ organizationName: `Org ${kind}`, websiteUrl: `https://k${i}.example.org`, sourceType: kind }), admin)).ok, kind).toBe(true);
    expect((await admin.admin!.listSources()).map((s) => s.sourceType).sort()).toEqual([...kinds].sort());
  });
  it("supports the access methods (official API / authorized feed / website / manual)", async () => {
    for (const [i, m] of ["official_api", "authorized_feed", "official_website", "manual"].entries()) expect((await handleSaveSource(src({ websiteUrl: `https://m${i}.example.org`, accessMethod: m }), admin)).ok).toBe(true);
    expect(await handleSaveSource(src({ websiteUrl: "https://bad.example.org", accessMethod: "scraper" }), admin)).toMatchObject({ ok: false, fieldErrors: { accessMethod: { code: "invalid_choice" } } });
  });
});

describe("CSV import: preview", () => {
  it("shows every row and problem and saves NOTHING", async () => {
    const before = (await admin.admin!.stats()).total;
    const res = await handleImportPreview(file(good(), good({ title_en: "Broken", opportunity_type: "nope", official_source_url: "https://official.test-university.org/p/two" })), admin);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.preview.rows.map((r) => r.status)).toEqual(["warning", "error"]);
    expect(res.preview.rows[1]!.issues.some((i) => i.column === "opportunity_type" && i.code === "invalid_choice")).toBe(true);
    expect(res.preview.summary).toMatchObject({ total: 2, importable: 1, error: 1 });
    expect((await admin.admin!.stats()).total).toBe(before);
  });
  it("does not leak full texts back (the preview carries titles and issues, not the whole row)", async () => {
    const res = await handleImportPreview(file(good({ description_en: "VERY-LONG-DESCRIPTION-TEXT" })), admin);
    expect(JSON.stringify(res)).not.toContain("VERY-LONG-DESCRIPTION-TEXT");
  });
  it("detects duplicates of existing opportunities", async () => {
    const existing = await handleSaveOpportunity(form({ organizationId: demo.organizationId, opportunityType: "scholarship", locationType: "onsite", country: "DE", originalLanguage: "az", deadlineType: "rolling", officialSourceUrl: "https://www.official.test-university.org/p/dup/?utm_source=mail", t_az_title: "Mövcud imkan", t_az_short: "q" }), admin);
    expect(existing.ok).toBe(true);
    const res = await handleImportPreview(file(good({ official_source_url: "https://official.test-university.org/p/dup" })), admin);
    expect(res.ok && res.preview.rows[0]!.status).toBe("duplicate");
    expect(res.ok && res.preview.rows[0]!.duplicates[0]).toMatchObject({ reason: "same_url", level: "exact" });
    // placeholder links (the demo data uses example.com) are never accepted as official sources
    const placeholder = await handleImportPreview(file(good({ official_source_url: "https://example.com/demo/x" })), admin);
    expect(placeholder.ok && placeholder.preview.rows[0]!.issues.map((i) => i.code)).toContain("url_placeholder_domain");
  });
  it("rejects non-text input and oversized files without throwing", async () => {
    expect(await handleImportPreview(42, admin)).toEqual({ ok: false, code: "invalid" });
    const big = await handleImportPreview("x".repeat(1_000_001), admin);
    expect(big.ok && big.preview.fileProblems).toContain("too_large");
  });
});

describe("CSV import: commit", () => {
  it("creates only importable rows, ALWAYS as unverified drafts with provenance; never publishes", async () => {
    const source = await handleSaveSource(form({ organizationName: "Official University", websiteUrl: "https://official.test-university.org", sourceType: "university", country: "DE", accessMethod: "official_website", isActive: "on" }), admin);
    expect(source.ok).toBe(true);
    const csv = file(
      good({ status: "published", publication_status: "published" } as never),
      good({ title_en: "Second", official_source_url: "https://official.test-university.org/p/two", title_az: "İkinci", short_az: "q", translations_reviewed: "yes" }),
      good({ title_en: "Broken", opportunity_type: "nope", official_source_url: "https://official.test-university.org/p/three" }),
      good({ title_en: "Dup of first", official_source_url: "https://official.test-university.org/p/one" }),
    );
    const res = await handleImportCommit(csv, {}, admin);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res).toMatchObject({ created: 2, failed: 0, skipped: 2 });
    expect(res.results.map((r) => r.outcome)).toEqual(["created", "created", "skipped", "skipped"]);
    expect(res.results[3]).toMatchObject({ reason: "duplicate" });
    expect(res.batch).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{6}$/);
    for (const r of res.results.filter((x) => x.outcome === "created")) {
      const rec = (await admin.admin!.get(r.id!))!;
      expect(rec).toMatchObject({ publicationStatus: "draft", verificationStatus: "unverified", verifiedBy: null, lastVerifiedAt: null, isDemo: false });
      expect((await admin.admin!.importInfo([rec.id]))[rec.id]).toEqual({ importBatch: res.batch, sourceId: (source as { id: string }).id });
    }
    const second = (await admin.admin!.get(res.results[1]!.id!))!;
    expect(second.translations.map((t) => `${t.language}:${t.status}`).sort()).toEqual(["az:human", "en:original"]);
    const batches = await admin.admin!.importBatches();
    expect(batches[0]).toMatchObject({ batch: res.batch, total: 2, draft: 2, published: 0 });
    expect((await admin.admin!.list({ batch: res.batch, page: 1 })).total).toBe(2);
    expect((await admin.admin!.list({ imported: true, page: 1 })).total).toBe(2);
  });
  it("imported translations of unknown origin stay hidden machine drafts until approved", async () => {
    const res = await handleImportCommit(file(good({ title_ru: "Русский заголовок", short_ru: "к" })), {}, admin);
    expect(res.ok && res.created).toBe(1);
    if (!res.ok) return;
    const rec = (await admin.admin!.get(res.results[0]!.id!))!;
    expect(rec.translations.find((t) => t.language === "ru")!.status).toBe("machine_draft");
  });
  it("the file cannot make a record published or verified: publishing still needs verification and review", async () => {
    const res = await handleImportCommit(file(good({ deadline_type: "fixed", deadline: "2030-01-01" })), {}, admin);
    if (!res.ok) throw new Error("commit failed");
    const id = res.results[0]!.id!;
    expect(await handleSetStatus(id, "in_review", admin)).toMatchObject({ ok: true });
    expect(await handleSetStatus(id, "published", admin)).toMatchObject({ ok: false, code: "publish_blocked", blockers: expect.arrayContaining(["not_verified"]) });
    expect((await handleSetVerification(id, true, admin)).ok).toBe(true);
    expect(await handleSetStatus(id, "published", admin)).toMatchObject({ ok: true });
  });
  it("possible duplicates are skipped unless the admin explicitly includes them", async () => {
    await handleImportCommit(file(good({ title_en: "Summer school in data science" })), {}, admin);
    const csv = file(good({ title_en: "Summer School in Data Science!", official_source_url: "https://official.test-university.org/p/other" }));
    const skipped = await handleImportCommit(csv, {}, admin);
    expect(skipped).toMatchObject({ ok: true, created: 0, skipped: 1 });
    expect(skipped.ok && skipped.results[0]!.reason).toBe("possible_duplicate");
    const included = await handleImportCommit(csv, { includePossibleDuplicates: true }, admin);
    expect(included).toMatchObject({ ok: true, created: 1 });
  });
  it("re-validates on the server: importing the same file twice creates the records once", async () => {
    const csv = file(good());
    expect(await handleImportCommit(csv, {}, admin)).toMatchObject({ ok: true, created: 1 });
    expect(await handleImportCommit(csv, {}, admin)).toMatchObject({ ok: true, created: 0, skipped: 1 });
    expect((await admin.admin!.list({ imported: true, page: 1 })).total).toBe(1);
  });
  it("refuses files with structural problems (missing columns, broken quoting) without saving anything", async () => {
    expect(await handleImportCommit("slug,title_en\nx,y", {}, admin)).toEqual({ ok: false, code: "invalid" });
    expect(await handleImportCommit(`${HEADER}\r\n"unterminated`, {}, admin)).toEqual({ ok: false, code: "invalid" });
    expect((await admin.admin!.list({ imported: true, page: 1 })).total).toBe(0);
  });
  it("one failing row does not stop the others (each row is its own transaction) and is reported", async () => {
    const failing = createFakeAdmin(admin.userId);
    const original = failing.save.bind(failing);
    let n = 0;
    failing.save = async (input) => { if (++n === 2) throw new Error("boom"); return original(input); };
    const res = await handleImportCommit(file(good(), good({ title_en: "Two", official_source_url: "https://official.test-university.org/p/2" }), good({ title_en: "Three", official_source_url: "https://official.test-university.org/p/3" })), {}, { ...admin, admin: failing });
    expect(res).toMatchObject({ ok: true, created: 2, failed: 1 });
    expect(res.ok && res.results.map((r) => r.outcome)).toEqual(["created", "failed", "created"]);
  });
  it("an imported record with a passed deadline is importable but shows as expired and can never be published", async () => {
    const res = await handleImportCommit(file(good({ deadline_type: "fixed", deadline: "2020-01-01" })), {}, admin);
    expect(res).toMatchObject({ ok: true, created: 1 });
    if (!res.ok) return;
    const id = res.results[0]!.id!;
    await handleSetVerification(id, true, admin);
    await handleSetStatus(id, "in_review", admin);
    const publish = await handleSetStatus(id, "published", admin);
    expect(publish).toMatchObject({ ok: false, code: "publish_blocked" });
    expect(!publish.ok && publish.blockers).toContain("already_expired");
  });
});

describe("expired opportunity detection", () => {
  it("flags verified opportunities whose deadline passed; unverified and open ones are untouched; idempotent", async () => {
    const make = async (extra: Record<string, string>) => {
      const r = await handleSaveOpportunity(form({ organizationId: demo.organizationId, opportunityType: "scholarship", locationType: "onsite", country: "DE", originalLanguage: "az", officialSourceUrl: "https://o.test-university.org/x", t_az_title: `T ${Math.random()}`, t_az_short: "q", ...extra }), admin);
      if (!r.ok) throw new Error(JSON.stringify(r));
      return r.id;
    };
    const past = await make({ deadlineType: "fixed", deadline: "2020-01-01T10:00" });
    const open = await make({ deadlineType: "fixed", deadline: "2099-01-01T10:00" });
    const unverified = await make({ deadlineType: "fixed", deadline: "2020-01-01T10:00" });
    await handleSetVerification(past, true, admin);
    await handleSetVerification(open, true, admin);
    expect((await admin.admin!.qualityReport()).expiredUnflagged).toEqual([past]);
    expect(await handleExpireCheck(admin)).toEqual({ ok: true, flagged: 1 });
    expect((await admin.admin!.get(past))!.verificationStatus).toBe("expired");
    expect((await admin.admin!.get(open))!.verificationStatus).toBe("verified");
    expect((await admin.admin!.get(unverified))!.verificationStatus).toBe("unverified");
    expect(await handleExpireCheck(admin)).toEqual({ ok: true, flagged: 0 });
  });
  it("the quality report lists overdue sources, never-checked ones included", async () => {
    const a = await handleSaveSource(form({ organizationName: "A", websiteUrl: "https://a.example.org", sourceType: "ngo", isActive: "on" }), admin);
    const b = await handleSaveSource(form({ organizationName: "B", websiteUrl: "https://b.example.org", sourceType: "ngo", isActive: "on" }), admin);
    if (!a.ok || !b.ok) throw new Error("setup");
    await handleMarkSourceChecked(b.id, admin);
    expect((await admin.admin!.qualityReport()).sourcesOverdue).toEqual([a.id]);
    expect((await admin.admin!.qualityReport(new Date(Date.now() + 120 * 86_400_000))).sourcesOverdue.sort()).toEqual([a.id, b.id].sort());
  });
});
