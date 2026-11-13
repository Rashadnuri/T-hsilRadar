import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFakeAuth } from "@/lib/auth/fake/gateway";
import { fakeState } from "@/lib/auth/fake/store";
import type { CookieJar } from "@/lib/auth/types";
import { handleRegister } from "@/features/auth/handlers";
import { handleSetSaved, handleSnapshot, handleTrack, handleUntrack, handleUpdateApplication, type PlanContext } from "./handlers";

const PUBLIC = new Set(["opp-1", "opp-2", "opp-expired"]);
const PW = "correct horse battery";

function jar(): CookieJar {
  const store = new Map<string, string>();
  return {
    getAll: () => [...store].map(([name, value]) => ({ name, value })),
    setAll: (cookies) => cookies.forEach(({ name, value, options }) => (options?.maxAge === 0 || value === "" ? store.delete(name) : store.set(name, value))),
  };
}

/** One browser: its own cookie jar, signed in as a freshly registered user. */
async function browser(email: string) {
  const { auth, profiles, plan } = createFakeAuth(jar());
  await handleRegister(
    form({ fullName: "Test User", email, password: PW, confirmPassword: PW }),
    { auth, profiles, locale: "en", siteUrl: "https://tahsilradar.test" },
  );
  const user = (await auth.getUser())!;
  const ctx: PlanContext = { auth, plan, isPublicOpportunity: async (id) => PUBLIC.has(id) };
  return { user, ctx, auth };
}
const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
};

beforeAll(() => {
  process.env.FAKE_AUTH_MAILBOX_FILE = join(mkdtempSync(join(tmpdir(), "tr-plan-")), "mailbox.jsonl");
  writeFileSync(process.env.FAKE_AUTH_MAILBOX_FILE, "");
});
beforeEach(() => {
  for (const m of Object.values(fakeState)) (m as Map<unknown, unknown>).clear();
  delete process.env.FAKE_AUTH_CONFIRM_EMAIL;
});

describe("saving", () => {
  it("saves a public opportunity, idempotently (no duplicates)", async () => {
    const { ctx } = await browser("a@example.com");
    expect(await handleSetSaved("opp-1", true, ctx)).toEqual({ ok: true, saved: true });
    expect(await handleSetSaved("opp-1", true, ctx)).toEqual({ ok: true, saved: true });
    const snapshot = await handleSnapshot(ctx);
    expect(snapshot.ok && snapshot.snapshot.saved).toEqual(["opp-1"]);
  });
  it("removes a saved opportunity, and removing twice is harmless", async () => {
    const { ctx } = await browser("a@example.com");
    await handleSetSaved("opp-1", true, ctx);
    expect(await handleSetSaved("opp-1", false, ctx)).toEqual({ ok: true, saved: false });
    expect(await handleSetSaved("opp-1", false, ctx)).toEqual({ ok: true, saved: false });
    const snapshot = await handleSnapshot(ctx);
    expect(snapshot.ok && snapshot.snapshot.saved).toEqual([]);
  });
  it("refuses opportunities that are not public, and malformed ids", async () => {
    const { ctx } = await browser("a@example.com");
    expect(await handleSetSaved("draft-9", true, ctx)).toEqual({ ok: false, code: "not_found" });
    expect(await handleSetSaved("x'; drop", true, ctx)).toEqual({ ok: false, code: "invalid" });
    expect(await handleSetSaved(undefined, true, ctx)).toEqual({ ok: false, code: "invalid" });
  });
  it("can still remove an item that has since stopped being public", async () => {
    const { ctx } = await browser("a@example.com");
    await handleSetSaved("opp-1", true, ctx);
    const unpublished: PlanContext = { ...ctx, isPublicOpportunity: async () => false };
    expect(await handleSetSaved("opp-1", false, unpublished)).toEqual({ ok: true, saved: false });
  });
  it("saves expired opportunities too", async () => {
    const { ctx } = await browser("a@example.com");
    expect(await handleSetSaved("opp-expired", true, ctx)).toEqual({ ok: true, saved: true });
  });
  it("needs a signed-in user", async () => {
    const anon = createFakeAuth(jar());
    const ctx: PlanContext = { auth: anon.auth, plan: anon.plan, isPublicOpportunity: async () => true };
    expect(await handleSetSaved("opp-1", true, ctx)).toEqual({ ok: false, code: "unauthorized" });
    expect(await handleTrack("opp-1", ctx)).toEqual({ ok: false, code: "unauthorized" });
    expect(await handleUntrack("opp-1", ctx)).toEqual({ ok: false, code: "unauthorized" });
    expect(await handleSnapshot(ctx)).toEqual({ ok: false, code: "unauthorized" });
    expect(await handleUpdateApplication(form({ opportunityId: "opp-1", status: "applied" }), ctx)).toEqual({ ok: false, code: "unauthorized" });
  });
  it("is unavailable when authentication is not configured (no repository)", async () => {
    const { ctx } = await browser("a@example.com");
    expect(await handleSetSaved("opp-1", true, { ...ctx, plan: null })).toEqual({ ok: false, code: "unauthorized" });
  });
});

describe("applications", () => {
  it("tracks with status 'interested', idempotently", async () => {
    const { ctx } = await browser("a@example.com");
    expect(await handleTrack("opp-1", ctx)).toEqual({ ok: true, status: "interested" });
    await handleUpdateApplication(form({ opportunityId: "opp-1", status: "applied", notes: "n" }), ctx);
    // tracking again must not reset the status or notes
    expect(await handleTrack("opp-1", ctx)).toEqual({ ok: true, status: "applied" });
    const s = await handleSnapshot(ctx);
    expect(s.ok && s.snapshot.applications).toEqual({ "opp-1": "applied" });
  });
  it("refuses to track a non-public opportunity", async () => {
    const { ctx } = await browser("a@example.com");
    expect(await handleTrack("draft-9", ctx)).toEqual({ ok: false, code: "not_found" });
  });
  it("updates status and notes, moving status_changed_at only when the status changes", async () => {
    const { ctx, user } = await browser("a@example.com");
    await handleTrack("opp-1", ctx);
    const before = (await ctx.plan!.listApplications(user.id))[0]!;
    await new Promise((r) => setTimeout(r, 5));
    const noteOnly = await handleUpdateApplication(form({ opportunityId: "opp-1", status: "interested", notes: "Ask Prof. K" }), ctx);
    expect(noteOnly.ok && noteOnly.notes).toBe("Ask Prof. K");
    const afterNote = (await ctx.plan!.listApplications(user.id))[0]!;
    expect(afterNote.statusChangedAt).toBe(before.statusChangedAt);
    expect(afterNote.updatedAt >= before.updatedAt).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    await handleUpdateApplication(form({ opportunityId: "opp-1", status: "interview", notes: "Ask Prof. K" }), ctx);
    const afterStatus = (await ctx.plan!.listApplications(user.id))[0]!;
    expect(afterStatus.status).toBe("interview");
    expect(afterStatus.statusChangedAt > before.statusChangedAt).toBe(true);
  });
  it("supports every status transition, including from final statuses back", async () => {
    const { ctx } = await browser("a@example.com");
    await handleTrack("opp-1", ctx);
    for (const status of ["preparing", "applied", "interview", "accepted", "rejected", "withdrawn", "interested"]) {
      const r = await handleUpdateApplication(form({ opportunityId: "opp-1", status }), ctx);
      expect(r.ok && r.status).toBe(status);
    }
  });
  it("clears notes when they are blank", async () => {
    const { ctx } = await browser("a@example.com");
    await handleTrack("opp-1", ctx);
    await handleUpdateApplication(form({ opportunityId: "opp-1", status: "applied", notes: "secret" }), ctx);
    const r = await handleUpdateApplication(form({ opportunityId: "opp-1", status: "applied", notes: "  " }), ctx);
    expect(r.ok && r.notes).toBeNull();
  });
  it("reports validation problems as codes and keeps the stored data untouched", async () => {
    const { ctx, user } = await browser("a@example.com");
    await handleTrack("opp-1", ctx);
    await handleUpdateApplication(form({ opportunityId: "opp-1", status: "applied", notes: "keep me" }), ctx);
    const bad = await handleUpdateApplication(form({ opportunityId: "opp-1", status: "nope", notes: "x".repeat(6000) }), ctx);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.code).toBe("invalid");
      expect(bad.fieldErrors?.status?.code).toBe("invalid_choice");
      expect(bad.fieldErrors?.notes?.code).toBe("text_too_long");
    }
    expect((await ctx.plan!.listApplications(user.id))[0]).toMatchObject({ status: "applied", notes: "keep me" });
  });
  it("updating an application that does not exist is 'not_found', never an insert", async () => {
    const { ctx, user } = await browser("a@example.com");
    expect(await handleUpdateApplication(form({ opportunityId: "opp-2", status: "applied" }), ctx)).toEqual({ ok: false, code: "not_found" });
    expect(await ctx.plan!.listApplications(user.id)).toEqual([]);
  });
  it("untracks (deleting the notes) and is idempotent", async () => {
    const { ctx, user } = await browser("a@example.com");
    await handleTrack("opp-1", ctx);
    await handleUpdateApplication(form({ opportunityId: "opp-1", status: "applied", notes: "n" }), ctx);
    expect(await handleUntrack("opp-1", ctx)).toEqual({ ok: true });
    expect(await handleUntrack("opp-1", ctx)).toEqual({ ok: true });
    expect(await ctx.plan!.listApplications(user.id)).toEqual([]);
  });
});

describe("user isolation", () => {
  it("each user sees and changes only their own plan", async () => {
    const a = await browser("a@example.com");
    const b = await browser("b@example.com");
    await handleSetSaved("opp-1", true, a.ctx);
    await handleTrack("opp-1", a.ctx);
    await handleUpdateApplication(form({ opportunityId: "opp-1", status: "interview", notes: "A-PRIVATE" }), a.ctx);

    const snapshotB = await handleSnapshot(b.ctx);
    expect(snapshotB.ok && snapshotB.snapshot).toEqual({ saved: [], applications: {} });
    expect(await b.ctx.plan!.listApplications(b.user.id)).toEqual([]);
    expect(await b.ctx.plan!.listApplications(a.user.id)).not.toEqual([]); // the repository is keyed by the id it is given…

    // …which is why handlers never take an id from the browser: B editing "opp-1" touches B's own (missing) record only.
    expect(await handleUpdateApplication(form({ opportunityId: "opp-1", status: "rejected", notes: "hijack" }), b.ctx)).toEqual({ ok: false, code: "not_found" });
    await handleUntrack("opp-1", b.ctx);
    await handleSetSaved("opp-1", false, b.ctx);

    const applicationA = (await a.ctx.plan!.listApplications(a.user.id))[0]!;
    expect(applicationA).toMatchObject({ status: "interview", notes: "A-PRIVATE" });
    expect((await handleSnapshot(a.ctx)).ok).toBe(true);
    const sa = await handleSnapshot(a.ctx);
    expect(sa.ok && sa.snapshot.saved).toEqual(["opp-1"]);
  });
  it("the same opportunity can be saved by two users independently", async () => {
    const a = await browser("a@example.com");
    const b = await browser("b@example.com");
    await handleSetSaved("opp-1", true, a.ctx);
    await handleSetSaved("opp-1", true, b.ctx);
    await handleSetSaved("opp-1", false, a.ctx);
    const sb = await handleSnapshot(b.ctx);
    expect(sb.ok && sb.snapshot.saved).toEqual(["opp-1"]);
  });
  it("a snapshot never contains notes", async () => {
    const a = await browser("a@example.com");
    await handleTrack("opp-1", a.ctx);
    await handleUpdateApplication(form({ opportunityId: "opp-1", status: "applied", notes: "TOP-SECRET" }), a.ctx);
    expect(JSON.stringify(await handleSnapshot(a.ctx))).not.toContain("TOP-SECRET");
  });
  it("a logged-out browser loses access immediately", async () => {
    const a = await browser("a@example.com");
    await handleSetSaved("opp-1", true, a.ctx);
    await a.auth.signOut();
    expect(await handleSnapshot(a.ctx)).toEqual({ ok: false, code: "unauthorized" });
  });
});

describe("limits", () => {
  it("stops at 500 saved opportunities per user", async () => {
    const { ctx } = await browser("a@example.com");
    const open: PlanContext = { ...ctx, isPublicOpportunity: async () => true };
    for (let i = 0; i < 500; i++) await handleSetSaved(`o-${i}`, true, open);
    expect(await handleSetSaved("o-500", true, open)).toEqual({ ok: false, code: "limit" });
  });
});
