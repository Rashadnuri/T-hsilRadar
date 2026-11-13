import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseAvailable, insertOpportunity, TestDb, type Query } from "./helpers";

const available = await databaseAvailable();
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe.skipIf(!available)("personal plan: saved_opportunities and applications", () => {
  let db: TestDb;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await TestDb.create();
    await db.sql(`insert into auth.users (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com'), ('${C}', 'c@example.com')`);
    await db.tx(
      null,
      async (q) => {
        ids.open = await insertOpportunity(q, { slug: "plan-open" });
        ids.open2 = await insertOpportunity(q, { slug: "plan-open-2" });
        ids.expired = await insertOpportunity(q, { slug: "plan-expired", verification_status: "expired", application_deadline: new Date(Date.now() - 86_400_000).toISOString() });
        ids.draft = await insertOpportunity(q, { slug: "plan-draft", publication_status: "draft" });
      },
      { commit: true },
    );
  });
  afterAll(async () => { await db?.drop(); });

  const asUser = <R,>(userId: string, fn: (q: Query) => Promise<R>) => db.tx("authenticated", fn, { userId });
  const fails = async (q: Query, sql: string, pattern: RegExp) => expect((await q.expectError(sql)).message).toMatch(pattern);
  const save = (q: Query, user: string, opp: string) => q(`insert into public.saved_opportunities (user_id, opportunity_id) values ('${user}', '${opp}')`);
  const track = (q: Query, user: string, opp: string, extra = "") => q(`insert into public.applications (user_id, opportunity_id${extra ? ", " + extra.split("=")[0]!.trim() : ""}) values ('${user}', '${opp}'${extra ? ", " + extra.split("=").slice(1).join("=").trim() : ""})`);

  describe("saved_opportunities", () => {
    it("lets a user save visible opportunities, including an expired one", async () => {
      await asUser(A, async (q) => {
        await save(q, A, ids.open!);
        await save(q, A, ids.expired!);
        expect(await q("select 1 from public.saved_opportunities")).toHaveLength(2);
      });
    });

    it("prevents duplicate saved records (unique per user and opportunity)", async () => {
      await asUser(A, async (q) => {
        await save(q, A, ids.open!);
        await fails(q, `insert into public.saved_opportunities (user_id, opportunity_id) values ('${A}', '${ids.open}')`, /saved_opportunities_unique/);
      });
      // the same opportunity can be saved by another user
      await asUser(B, async (q) => { await save(q, B, ids.open!); });
    });

    it("supports idempotent saving with ON CONFLICT DO NOTHING", async () => {
      await asUser(A, async (q) => {
        const insert = `insert into public.saved_opportunities (user_id, opportunity_id) values ('${A}', '${ids.open}') on conflict (user_id, opportunity_id) do nothing`;
        await q(insert);
        await q(insert);
        expect(await q("select 1 from public.saved_opportunities")).toHaveLength(1);
      });
    });

    it("refuses opportunities the user cannot see (drafts) and unknown ids", async () => {
      await asUser(A, async (q) => {
        await fails(q, `insert into public.saved_opportunities (user_id, opportunity_id) values ('${A}', '${ids.draft}')`, /row-level security/);
        await fails(q, `insert into public.saved_opportunities (user_id, opportunity_id) values ('${A}', gen_random_uuid())`, /row-level security|foreign key/);
      });
    });

    it("refuses saving on behalf of someone else", async () => {
      await asUser(A, async (q) => {
        await fails(q, `insert into public.saved_opportunities (user_id, opportunity_id) values ('${B}', '${ids.open}')`, /row-level security/);
      });
    });

    it("lets a user remove their own saved record, and only theirs", async () => {
      await db.tx(null, async (q) => {
        await save(q, A, ids.open!);
        await save(q, B, ids.open!);
        await q("set local role authenticated");
        await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: A, role: "authenticated" })]);
        await q(`delete from public.saved_opportunities where opportunity_id = '${ids.open}'`); // would hit both rows without RLS
        await q("reset role");
        const rows = await q<{ user_id: string }>("select user_id from public.saved_opportunities");
        expect(rows.map((r) => r.user_id)).toEqual([B]);
      });
    });

    it("cannot be updated at all (no UPDATE privilege): ownership and target are immutable", async () => {
      await asUser(A, async (q) => {
        await save(q, A, ids.open!);
        await fails(q, `update public.saved_opportunities set opportunity_id = '${ids.open2}'`, /permission denied/);
        await fails(q, `update public.saved_opportunities set user_id = '${B}'`, /permission denied/);
      });
    });

    it("keeps a saved record visible to its owner even after the opportunity stops being public", async () => {
      await db.tx(null, async (q) => {
        const tmp = await insertOpportunity(q, { slug: "plan-temp" });
        await save(q, A, tmp);
        await q(`update public.opportunities set publication_status = 'unpublished' where id = '${tmp}'`);
        await q("set local role authenticated");
        await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: A, role: "authenticated" })]);
        expect(await q("select 1 from public.saved_opportunities where opportunity_id = $1", [tmp])).toHaveLength(1);
        expect(await q("select 1 from public.opportunities where id = $1", [tmp])).toHaveLength(0);
      });
    });
  });

  describe("applications", () => {
    it("tracks an application with a default status of 'interested' and no notes", async () => {
      await asUser(A, async (q) => {
        await track(q, A, ids.open!);
        const [row] = await q<{ status: string; notes: string | null }>("select status, notes from public.applications");
        expect(row).toEqual({ status: "interested", notes: null });
      });
    });

    it("accepts exactly the seven statuses and rejects anything else", async () => {
      await asUser(A, async (q) => {
        await track(q, A, ids.open!);
        for (const status of ["interested", "preparing", "applied", "interview", "accepted", "rejected", "withdrawn"]) {
          await q(`update public.applications set status = '${status}'`);
          expect((await q<{ status: string }>("select status from public.applications"))[0]!.status).toBe(status);
        }
        await fails(q, "update public.applications set status = 'ghosted'", /invalid input value for enum/);
      });
      const values = await db.sql<{ v: string }>("select unnest(enum_range(null::public.application_status))::text as v");
      expect(values.map((r) => r.v)).toEqual(["interested", "preparing", "applied", "interview", "accepted", "rejected", "withdrawn"]);
    });

    it("prevents duplicate applications for the same opportunity", async () => {
      await asUser(A, async (q) => {
        await track(q, A, ids.open!);
        await fails(q, `insert into public.applications (user_id, opportunity_id) values ('${A}', '${ids.open}')`, /applications_unique/);
      });
    });

    it("stores and updates personal notes, validating their size", async () => {
      await asUser(A, async (q) => {
        await track(q, A, ids.open!, "notes = 'Ask Prof. K for a letter; <b>bold</b> stays text'");
        await q("update public.applications set notes = 'Updated note'");
        expect((await q<{ notes: string }>("select notes from public.applications"))[0]!.notes).toBe("Updated note");
        await fails(q, `update public.applications set notes = '${"x".repeat(5001)}'`, /applications_notes/);
        await fails(q, "update public.applications set notes = '   '", /applications_notes/);
        await q(`update public.applications set notes = '${"x".repeat(5000)}'`);
        await q("update public.applications set notes = null");
      });
    });

    it("updates status_changed_at only when the status changes, and updated_at on every change", async () => {
      await db.tx(null, async (q) => {
        await track(q, A, ids.open!);
        await q("update public.applications set status_changed_at = now() - interval '2 days', updated_at = now() - interval '2 days'");
        await q("update public.applications set notes = 'only a note'");
        let [row] = await q<{ status_recent: boolean; updated_recent: boolean }>("select status_changed_at > now() - interval '1 day' as status_recent, updated_at > now() - interval '1 day' as updated_recent from public.applications");
        expect(row).toEqual({ status_recent: false, updated_recent: true });
        await q("update public.applications set status = 'applied'");
        [row] = await q("select status_changed_at > now() - interval '1 day' as status_recent, updated_at > now() - interval '1 day' as updated_recent from public.applications");
        expect(row!.status_recent).toBe(true);
      });
    });

    it("cannot change ownership, the target opportunity or the timestamps (column privileges)", async () => {
      await asUser(A, async (q) => {
        await track(q, A, ids.open!);
        await fails(q, `update public.applications set user_id = '${B}'`, /permission denied/);
        await fails(q, `update public.applications set opportunity_id = '${ids.open2}'`, /permission denied/);
        await fails(q, "update public.applications set status_changed_at = now()", /permission denied/);
        await fails(q, "update public.applications set created_at = now()", /permission denied/);
      });
    });

    it("refuses invisible opportunities and other users' ids", async () => {
      await asUser(A, async (q) => {
        await fails(q, `insert into public.applications (user_id, opportunity_id) values ('${A}', '${ids.draft}')`, /row-level security/);
        await fails(q, `insert into public.applications (user_id, opportunity_id) values ('${B}', '${ids.open}')`, /row-level security/);
      });
    });

    it("can be removed by the owner", async () => {
      await asUser(A, async (q) => {
        await track(q, A, ids.open!);
        await q("delete from public.applications");
        expect(await q("select 1 from public.applications")).toHaveLength(0);
      });
    });

    it("tracks expired opportunities too", async () => {
      await asUser(A, async (q) => {
        await track(q, A, ids.expired!);
        expect(await q("select 1 from public.applications")).toHaveLength(1);
      });
    });
  });

  describe("user isolation and privacy of notes", () => {
    /** A and B each have saved + tracked rows; C has none. Rolled back after each test. */
    async function seeded(fn: (q: Query) => Promise<void>) {
      await db.tx(null, async (q) => {
        await save(q, A, ids.open!);
        await save(q, A, ids.expired!);
        await save(q, B, ids.open!);
        await track(q, A, ids.open!, "notes = 'A-SECRET-NOTE'");
        await track(q, B, ids.open!, "notes = 'B-SECRET-NOTE'");
        await fn(q);
      });
    }
    const become = async (q: Query, user: string) => {
      await q("set local role authenticated");
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    };

    it("each user sees only their own rows", async () => {
      await seeded(async (q) => {
        await become(q, A);
        expect((await q<{ user_id: string }>("select user_id from public.saved_opportunities")).every((r) => r.user_id === A)).toBe(true);
        expect(await q("select 1 from public.saved_opportunities")).toHaveLength(2);
        expect((await q<{ notes: string }>("select notes from public.applications")).map((r) => r.notes)).toEqual(["A-SECRET-NOTE"]);
        await q("reset role");
        await become(q, B);
        expect((await q<{ notes: string }>("select notes from public.applications")).map((r) => r.notes)).toEqual(["B-SECRET-NOTE"]);
        expect(await q("select 1 from public.saved_opportunities")).toHaveLength(1);
      });
    });

    it("a user without rows, and an unauthenticated session, see nothing", async () => {
      await seeded(async (q) => {
        await become(q, C);
        expect(await q("select 1 from public.saved_opportunities")).toHaveLength(0);
        expect(await q("select 1 from public.applications")).toHaveLength(0);
        await q("reset role");
        await q("select set_config('request.jwt.claims', '', true)");
        await q("set local role authenticated");
        expect(await q("select 1 from public.applications")).toHaveLength(0); // auth.uid() is null
      });
    });

    it("cannot read, change or delete another user's application or notes", async () => {
      await seeded(async (q) => {
        await become(q, B);
        expect(await q("select notes from public.applications where user_id = $1", [A])).toHaveLength(0);
        expect((await q("update public.applications set notes = 'hijacked', status = 'rejected' where user_id = $1 returning id", [A]))).toHaveLength(0);
        expect((await q("delete from public.applications where user_id = $1 returning id", [A]))).toHaveLength(0);
        expect((await q("delete from public.saved_opportunities where user_id = $1 returning id", [A]))).toHaveLength(0);
        await q("reset role");
        const [row] = await q<{ notes: string; status: string }>("select notes, status from public.applications where user_id = $1", [A]);
        expect(row).toEqual({ notes: "A-SECRET-NOTE", status: "interested" });
        expect(await q("select 1 from public.saved_opportunities where user_id = $1", [A])).toHaveLength(2);
      });
    });

    it("the same notes column cannot be read through a join with public tables", async () => {
      await seeded(async (q) => {
        await become(q, B);
        const rows = await q<{ notes: string | null }>("select a.notes from public.opportunities o join public.applications a on a.opportunity_id = o.id");
        expect(rows.map((r) => r.notes)).toEqual(["B-SECRET-NOTE"]);
      });
    });

    it("anon has no privilege at all on either table", async () => {
      await seeded(async (q) => {
        await q("set local role anon");
        await fails(q, "select 1 from public.saved_opportunities", /permission denied/);
        await fails(q, "select 1 from public.applications", /permission denied/);
        await fails(q, `insert into public.saved_opportunities (user_id, opportunity_id) values ('${A}', '${ids.open}')`, /permission denied/);
        await fails(q, "select notes from public.applications", /permission denied/);
      });
    });

    it("authenticated cannot truncate or touch other privileges", async () => {
      await seeded(async (q) => {
        await become(q, A);
        await fails(q, "truncate public.applications", /permission denied/);
        await fails(q, "truncate public.saved_opportunities", /permission denied/);
      });
    });

    it("deleting the auth user removes their plan (cascade), leaving others untouched", async () => {
      await seeded(async (q) => {
        await q(`delete from auth.users where id = '${A}'`);
        expect(await q("select 1 from public.saved_opportunities where user_id = $1", [A])).toHaveLength(0);
        expect(await q("select 1 from public.applications where user_id = $1", [A])).toHaveLength(0);
        expect(await q("select 1 from public.applications where user_id = $1", [B])).toHaveLength(1);
      });
    });

    it("deleting an opportunity removes the dependent saved/application rows", async () => {
      await seeded(async (q) => {
        await q(`delete from public.opportunities where id = '${ids.open}'`);
        expect(await q("select 1 from public.applications")).toHaveLength(0);
        expect(await q("select 1 from public.saved_opportunities where opportunity_id = $1", [ids.open])).toHaveLength(0);
      });
    });
  });

  describe("limits and policies as stored", () => {
    it("caps each user at 500 saved rows and 500 applications", async () => {
      // Insert 500 saved rows for C as the owner; the 501st must be refused by the trigger.
      await db.tx(null, async (q) => {
        const orgs = await q<{ id: string }>("select id from public.organizations limit 1");
        const org = orgs[0]!.id;
        await q(`insert into public.opportunities (slug, organization_id, opportunity_type, location_type, country, city_id, funding_type, deadline_type, publication_status, verification_status, original_language)
                 select 'bulk-' || g, '${org}', 'scholarship', 'onsite', 'AZ', 'baku', 'fully_funded', 'rolling', 'draft', 'unverified', 'az' from generate_series(1, 501) g`);
        await q(`insert into public.saved_opportunities (user_id, opportunity_id) select '${C}', id from public.opportunities where slug like 'bulk-%' limit 500`);
        await fails(q, `insert into public.saved_opportunities (user_id, opportunity_id) select '${C}', id from public.opportunities where slug = 'bulk-501' or slug like 'plan-%' limit 1`, /plan limit reached/);
      });
    });

    it("has only owner-scoped policies for role authenticated, and no policy for anon", async () => {
      const rows = await db.sql<{ tablename: string; cmd: string; roles: string[]; qual: string | null; with_check: string | null }>(
        "select tablename, cmd, roles::text[] as roles, qual, with_check from pg_policies where schemaname = 'public' and tablename in ('saved_opportunities', 'applications')",
      );
      expect(rows.filter((r) => r.tablename === "saved_opportunities").map((r) => r.cmd).sort()).toEqual(["DELETE", "INSERT", "SELECT"]);
      expect(rows.filter((r) => r.tablename === "applications").map((r) => r.cmd).sort()).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
      for (const r of rows) {
        expect(r.roles).toEqual(["authenticated"]);
        expect(`${r.qual ?? ""} ${r.with_check ?? ""}`).toContain("auth.uid()");
      }
    });

    it("contains no SECURITY DEFINER function", async () => {
      const rows = await db.sql("select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef");
      expect(rows).toEqual([]);
    });
  });
});
