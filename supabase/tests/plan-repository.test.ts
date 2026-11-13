import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabasePlanRepository } from "@/repositories/plan/supabase-plan-repository";
import { PlanRepositoryError } from "@/repositories/plan/types";
import { databaseAvailable, insertOpportunity, TestDb } from "./helpers";

const available = await databaseAvailable();
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** The repository as the application uses it: one per signed-in user (role `authenticated` + that user's JWT claims). */
describe.skipIf(!available)("SupabasePlanRepository under row level security", () => {
  let db: TestDb;
  let alice: SupabasePlanRepository;
  let bob: SupabasePlanRepository;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await TestDb.create();
    await db.sql(`insert into auth.users (id, email) values ('${A}', 'alice@example.com'), ('${B}', 'bob@example.com')`);
    await db.tx(null, async (q) => {
      ids.one = await insertOpportunity(q, { slug: "repo-one" });
      ids.two = await insertOpportunity(q, { slug: "repo-two" });
      ids.expired = await insertOpportunity(q, { slug: "repo-expired", verification_status: "expired", application_deadline: new Date(Date.now() - 86_400_000).toISOString() });
      ids.draft = await insertOpportunity(q, { slug: "repo-draft", publication_status: "draft" });
    }, { commit: true });
    alice = new SupabasePlanRepository(db.client("authenticated", { userId: A }));
    bob = new SupabasePlanRepository(db.client("authenticated", { userId: B }));
  });
  afterAll(async () => { await db?.drop(); });

  it("saves, lists (newest first) and removes saved opportunities; saving twice keeps one", async () => {
    await alice.save(A, ids.one!);
    await alice.save(A, ids.one!);
    await alice.save(A, ids.expired!);
    const saved = await alice.listSaved(A);
    expect(saved.map((s) => s.opportunityId).sort()).toEqual([ids.expired, ids.one].sort());
    expect(saved).toHaveLength(2);
    expect(saved[0]!.id).toBeTruthy();
    await alice.unsave(A, ids.one!);
    await alice.unsave(A, ids.one!); // harmless
    expect((await alice.listSaved(A)).map((s) => s.opportunityId)).toEqual([ids.expired]);
  });

  it("tracks an application, then changes status and notes", async () => {
    const created = await alice.track(A, ids.two!);
    expect(created).toMatchObject({ opportunityId: ids.two, status: "interested", notes: null });
    const again = await alice.track(A, ids.two!);
    expect(again.id).toBe(created.id); // idempotent
    const updated = await alice.updateApplication(A, ids.two!, { status: "interview", notes: "Prepare portfolio" });
    expect(updated).toMatchObject({ status: "interview", notes: "Prepare portfolio" });
    expect(updated!.statusChangedAt >= created.statusChangedAt).toBe(true);
    // tracking again must not reset what the person entered
    expect(await alice.track(A, ids.two!)).toMatchObject({ status: "interview", notes: "Prepare portfolio" });
    expect(await alice.updateApplication(A, ids.two!, { notes: null })).toMatchObject({ status: "interview", notes: null });
    expect((await alice.listApplications(A)).map((a) => a.opportunityId)).toEqual([ids.two]);
  });

  it("returns null when updating an application that does not exist", async () => {
    expect(await alice.updateApplication(A, ids.one!, { status: "applied" })).toBeNull();
  });

  it("refuses opportunities the user cannot see, without leaking why", async () => {
    await expect(alice.save(A, ids.draft!)).rejects.toMatchObject({ name: "PlanRepositoryError", reason: "not_visible" });
    await expect(alice.track(A, ids.draft!)).rejects.toBeInstanceOf(PlanRepositoryError);
    await expect(alice.save(A, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ reason: "not_visible" });
  });

  it("refuses to act for another user id even when asked to", async () => {
    // Bob's session, Alice's id: the policies (user_id = auth.uid()) refuse the write…
    await expect(bob.save(A, ids.one!)).rejects.toMatchObject({ reason: "not_visible" });
    await expect(bob.track(A, ids.one!)).rejects.toMatchObject({ reason: "not_visible" });
    // …and reads under Alice's id return nothing, because RLS hides her rows from Bob.
    expect(await bob.listSaved(A)).toEqual([]);
    expect(await bob.listApplications(A)).toEqual([]);
  });

  it("keeps users isolated: Bob sees none of Alice's rows or notes and cannot change or delete them", async () => {
    await alice.updateApplication(A, ids.two!, { status: "applied", notes: "ALICE-PRIVATE" });
    expect(await bob.listApplications(B)).toEqual([]);
    expect(await bob.listSaved(B)).toEqual([]);

    expect(await bob.updateApplication(A, ids.two!, { status: "rejected", notes: "hijack" })).toBeNull();
    await bob.untrack(A, ids.two!);
    await bob.unsave(A, ids.expired!);

    expect(await alice.listApplications(A)).toMatchObject([{ opportunityId: ids.two, status: "applied", notes: "ALICE-PRIVATE" }]);
    expect((await alice.listSaved(A)).map((s) => s.opportunityId)).toEqual([ids.expired]);
  });

  it("gives each user an independent record for the same opportunity", async () => {
    await bob.save(B, ids.expired!);
    await bob.track(B, ids.two!);
    await bob.updateApplication(B, ids.two!, { status: "accepted", notes: "BOB-PRIVATE" });
    expect(await alice.listApplications(A)).toMatchObject([{ status: "applied", notes: "ALICE-PRIVATE" }]);
    expect(await bob.listApplications(B)).toMatchObject([{ status: "accepted", notes: "BOB-PRIVATE" }]);
  });

  it("lets a user annotate and remove an application whose opportunity was unpublished", async () => {
    await db.tx(null, async (q) => { await q(`update public.opportunities set publication_status = 'unpublished' where id = '${ids.two}'`); }, { commit: true });
    expect(await alice.updateApplication(A, ids.two!, { notes: "still editable" })).toMatchObject({ notes: "still editable" });
    await alice.untrack(A, ids.two!);
    expect(await alice.listApplications(A)).toEqual([]);
  });

  it("removes a user's rows when the auth user is deleted", async () => {
    await db.sql(`delete from auth.users where id = '${B}'`);
    expect(await db.sql("select 1 from public.applications where user_id = $1".replace("$1", `'${B}'`))).toHaveLength(0);
    expect(await db.sql("select 1 from public.saved_opportunities where user_id = " + `'${B}'`)).toHaveLength(0);
  });

  it("errors never contain private notes", async () => {
    try {
      await alice.track(A, ids.draft!);
    } catch (error) {
      expect(String((error as Error).message)).not.toMatch(/ALICE-PRIVATE|notes/i);
    }
  });
});
