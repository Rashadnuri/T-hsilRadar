import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseAvailable, TestDb, type Query } from "./helpers";

const available = await databaseAvailable();
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // an auth user who never created a profile

const lit = (v: unknown): string => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const arr = (values: string[]) => `array[${values.map(lit).join(",")}]::text[]`;

describe.skipIf(!available)("profiles: constraints and user isolation", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await TestDb.create();
    await db.sql(`insert into auth.users (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com'), ('${C}', 'c@example.com')`);
  });
  afterAll(async () => { await db?.drop(); });

  const fails = async (q: Query, sql: string, pattern: RegExp) => expect((await q.expectError(sql)).message).toMatch(pattern);

  const valid = {
    full_name: "Aysel Məmmədova", education_level: "bachelor", university: "Demo University of Technology", academic_field: "ict", graduation_year: 2027,
    country_of_residence: "AZ",
  };
  /** Inserts a valid profile, replacing columns per an "assignment" such as `skills = array[...]`. */
  const insertProfile = (q: Query, id: string, assignment = "") => {
    const columns: Record<string, string> = {
      id: lit(id), full_name: lit(valid.full_name), education_level: "'bachelor'", university: lit(valid.university), academic_field: "'ict'",
      graduation_year: "2027", country_of_residence: "'AZ'",
    };
    if (assignment) {
      const at = assignment.indexOf(" = ");
      columns[assignment.slice(0, at)] = assignment.slice(at + 3);
    }
    return q(`insert into public.profiles (${Object.keys(columns).join(", ")}) values (${Object.values(columns).join(", ")})`);
  };

  describe("field constraints", () => {
    it("accepts a complete, valid profile (and a completely empty one with defaults)", async () => {
      await db.tx(null, async (q) => {
        await q(`insert into public.profiles (id, full_name, education_level, university, academic_field, graduation_year, country_of_residence, preferred_countries, skills, languages, career_interests, preferred_opportunity_types)
          values ('${A}', ${lit(valid.full_name)}, 'master', ${lit(valid.university)}, 'engineering', 2026, 'AZ', ${arr(["DE", "TR"])}, ${arr(["Python", "Public speaking"])},
                  '[{"code":"az","level":"native"},{"code":"en","level":"B2"}]'::jsonb, ${arr(["Data science"])}, ${arr(["scholarship", "internship"])})`);
        await q(`insert into public.profiles (id) values ('${B}')`);
        const [row] = await q<{ skills: string[]; languages: unknown[]; preferred_countries: string[] }>(`select skills, languages, preferred_countries from public.profiles where id = '${B}'`);
        expect(row).toEqual({ skills: [], languages: [], preferred_countries: [] });
      });
    });

    const bad: [string, string, RegExp][] = [
      ["empty name", "full_name = ''", /profiles_full_name/],
      ["whitespace-only name", "full_name = '   '", /profiles_full_name/],
      ["over-long name", `full_name = '${"x".repeat(121)}'`, /profiles_full_name/],
      ["HTML in the name", "full_name = '<script>alert(1)</script>'", /profiles_full_name/],
      ["over-long university", `university = '${"x".repeat(201)}'`, /profiles_university/],
      ["HTML in the university", "university = 'Uni <b>x</b>'", /profiles_university/],
      ["unknown education level", "education_level = 'kindergarten'", /invalid input value for enum/],
      ["unknown academic field", "academic_field = 'astrology'", /invalid input value for enum/],
      ["graduation year too early", "graduation_year = 1900", /profiles_graduation_year/],
      ["graduation year too late", "graduation_year = 2300", /profiles_graduation_year/],
      ["lower-case country of residence", "country_of_residence = 'az'", /profiles_country_of_residence/],
      ["three-letter country", "country_of_residence = 'AZE'", /profiles_country_of_residence/],
      ["duplicate preferred countries", `preferred_countries = ${arr(["DE", "DE"])}`, /profiles_preferred_countries/],
      ["invalid preferred country", `preferred_countries = ${arr(["Germany"])}`, /profiles_preferred_countries/],
      ["more than 20 preferred countries", `preferred_countries = ${arr(Array.from({ length: 21 }, (_, i) => String.fromCharCode(65 + (i % 26)) + "A"))}`, /profiles_preferred_countries/],
      ["duplicate skills ignoring case", `skills = ${arr(["Python", "python"])}`, /profiles_skills/],
      ["empty skill", `skills = ${arr([""])}`, /profiles_skills/],
      ["skill with surrounding spaces", `skills = ${arr([" Python"])}`, /profiles_skills/],
      ["over-long skill", `skills = ${arr(["x".repeat(51)])}`, /profiles_skills/],
      ["HTML in a skill", `skills = ${arr(["<img src=x onerror=1>"])}`, /profiles_skills/],
      ["more than 30 skills", `skills = ${arr(Array.from({ length: 31 }, (_, i) => `skill ${i}`))}`, /profiles_skills/],
      ["more than 20 career interests", `career_interests = ${arr(Array.from({ length: 21 }, (_, i) => `interest ${i}`))}`, /profiles_career_interests/],
      ["languages not an array", `languages = '{"code":"en","level":"B2"}'::jsonb`, /profiles_languages/],
      ["language with an unknown level", `languages = '[{"code":"en","level":"expert"}]'::jsonb`, /profiles_languages/],
      ["language with a bad code", `languages = '[{"code":"english","level":"B2"}]'::jsonb`, /profiles_languages/],
      ["language missing its level", `languages = '[{"code":"en"}]'::jsonb`, /profiles_languages/],
      ["language with extra keys", `languages = '[{"code":"en","level":"B2","x":1}]'::jsonb`, /profiles_languages/],
      ["duplicate language", `languages = '[{"code":"en","level":"B2"},{"code":"en","level":"C1"}]'::jsonb`, /profiles_languages/],
      ["non-string language code", `languages = '[{"code":5,"level":"B2"}]'::jsonb`, /profiles_languages/],
      ["unknown preferred opportunity type", `preferred_opportunity_types = ${arr(["lottery"])}`, /unknown category/],
      ["duplicate preferred types", `preferred_opportunity_types = ${arr(["grant", "grant"])}`, /profiles_preferred_types_shape/],
    ];
    it.each(bad)("rejects: %s", async (_name, assignment, pattern) => {
      await db.tx(null, async (q) => {
        const message = await insertProfile(q, A, assignment).then(() => "ACCEPTED", (e: Error) => e.message);
        expect(message).toMatch(pattern);
      });
    });

    it("an inactive category cannot be chosen as a preferred type", async () => {
      await db.tx(null, async (q) => {
        await q("update public.categories set is_active = false where code = 'hackathon'");
        await fails(q, `insert into public.profiles (id, preferred_opportunity_types) values ('${A}', ${arr(["hackathon"])})`, /unknown category/);
      });
    });
    it("a profile cannot exist without its auth user (foreign key), and disappears with it (cascade)", async () => {
      await db.tx(null, async (q) => {
        await fails(q, "insert into public.profiles (id) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd')", /foreign key|violates/i);
        await q("insert into auth.users (id, email) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'e@example.com')");
        await q("insert into public.profiles (id) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')");
        await q("delete from auth.users where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'");
        expect(await q("select 1 from public.profiles where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'")).toHaveLength(0);
      });
    });
    it("updated_at is maintained", async () => {
      const id = "99999999-9999-4999-8999-999999999999";
      await db.sql(`insert into auth.users (id, email) values ('${id}', 'u@example.com')`);
      await db.sql(`insert into public.profiles (id) values ('${id}')`);
      const read = async () => (await db.sql<{ updated_at: string }>(`select updated_at from public.profiles where id = '${id}'`))[0]!.updated_at;
      const first = await read();
      await db.sql("select pg_sleep(0.05)");
      await db.sql(`update public.profiles set full_name = 'Changed' where id = '${id}'`);
      expect(new Date(await read()).getTime()).toBeGreaterThan(new Date(first).getTime());
      await db.sql(`delete from auth.users where id = '${id}'`);
    });
  });

  describe("user isolation (row level security)", () => {
    /** Creates profiles for A and B as the trusted owner, then runs `fn` as the given user. */
    async function withTwoProfiles<R>(userId: string | null, role: "authenticated" | "anon" | "service_role", fn: (q: Query) => Promise<R>): Promise<R> {
      return db.tx(null, async (q) => {
        await q(`insert into public.profiles (id, full_name, university) values ('${A}', 'Alice Private', 'Alice University'), ('${B}', 'Bob Private', 'Bob University')`);
        await q(`set local role ${role}`);
        if (userId) await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role })]);
        return fn(q);
      });
    }

    it("a user reads only their OWN profile — never another user's", async () => {
      await withTwoProfiles(A, "authenticated", async (q) => {
        expect((await q<{ full_name: string }>("select full_name from public.profiles")).map((r) => r.full_name)).toEqual(["Alice Private"]);
        expect(await q(`select * from public.profiles where id = '${B}'`)).toHaveLength(0);
        expect(await q("select * from public.profiles where full_name = 'Bob Private'")).toHaveLength(0);
        expect(await q("select * from public.profiles where university ilike '%bob%'")).toHaveLength(0);
      });
      await withTwoProfiles(B, "authenticated", async (q) => {
        expect((await q<{ full_name: string }>("select full_name from public.profiles")).map((r) => r.full_name)).toEqual(["Bob Private"]);
        expect(await q(`select * from public.profiles where id = '${A}'`)).toHaveLength(0);
        // aggregates and ordering cannot leak other rows either
        expect((await q<{ n: number }>("select count(*)::int as n from public.profiles"))[0]!.n).toBe(1);
      });
    });

    it("a user can update their own profile but cannot touch another user's (zero rows affected)", async () => {
      await withTwoProfiles(A, "authenticated", async (q) => {
        expect(await q(`update public.profiles set full_name = 'Alice Updated' where id = '${A}' returning id`)).toHaveLength(1);
        expect(await q(`update public.profiles set full_name = 'HACKED' where id = '${B}' returning id`)).toHaveLength(0);
        expect(await q("update public.profiles set full_name = 'HACKED' returning id")).toHaveLength(1); // an unfiltered update only reaches own row
      });
      // …and Bob's data is untouched (checked as the trusted owner)
      await withTwoProfiles(A, "authenticated", async (q) => {
        await q(`update public.profiles set university = 'Mine' where id = '${A}'`);
        await q("reset role");
        expect((await q<{ full_name: string }>(`select full_name from public.profiles where id = '${B}'`))[0]!.full_name).toBe("Bob Private");
      });
    });

    it("a user cannot create a profile for someone else", async () => {
      await db.tx("authenticated", async (q) => {
        await fails(q, `insert into public.profiles (id, full_name) values ('${B}', 'Impersonation')`, /row-level security/);
      }, { userId: A });
    });

    it("a user can create their own profile; saving again updates it (upsert)", async () => {
      await db.tx("authenticated", async (q) => {
        await q(`insert into public.profiles (id, full_name) values ('${C}', 'Carol')`);
        await q(`insert into public.profiles (id, full_name) values ('${C}', 'Carol Two') on conflict (id) do update set full_name = excluded.full_name`);
        expect((await q<{ full_name: string }>("select full_name from public.profiles"))[0]!.full_name).toBe("Carol Two");
      }, { userId: C });
    });

    it("an upsert aimed at another user's row is rejected, not silently applied", async () => {
      await withTwoProfiles(A, "authenticated", async (q) => {
        await fails(q, `insert into public.profiles (id, full_name) values ('${B}', 'Takeover') on conflict (id) do update set full_name = excluded.full_name`, /row-level security/);
      });
    });

    it("ownership cannot be transferred: id and created_at are not updatable", async () => {
      await withTwoProfiles(A, "authenticated", async (q) => {
        await fails(q, `update public.profiles set id = '${C}' where id = '${A}'`, /permission denied/);
        await fails(q, `update public.profiles set id = '${B}' where id = '${A}'`, /permission denied/);
        await fails(q, "update public.profiles set created_at = now() - interval '10 years'", /permission denied/);
      });
    });

    it("nobody but the system can delete a profile", async () => {
      await withTwoProfiles(A, "authenticated", async (q) => {
        await fails(q, `delete from public.profiles where id = '${A}'`, /permission denied/);
        await fails(q, "truncate public.profiles", /permission denied/);
      });
    });

    it("anon (not signed in) has no access whatsoever", async () => {
      await withTwoProfiles(null, "anon", async (q) => {
        await fails(q, "select * from public.profiles", /permission denied/);
        await fails(q, "select id from public.profiles", /permission denied/);
        await fails(q, `insert into public.profiles (id) values ('${C}')`, /permission denied/);
        await fails(q, "update public.profiles set full_name = 'x'", /permission denied/);
        await fails(q, "delete from public.profiles", /permission denied/);
      });
    });

    it("a request without a verified identity (auth.uid() is NULL) sees nothing and can create nothing", async () => {
      await withTwoProfiles(null, "authenticated", async (q) => {
        expect(await q("select * from public.profiles")).toHaveLength(0);
        await fails(q, `insert into public.profiles (id) values ('${C}')`, /row-level security/);
      });
    });

    it("a forged claim for a user that does not exist cannot create a profile", async () => {
      await db.tx("authenticated", async (q) => {
        await fails(q, "insert into public.profiles (id) values ('ffffffff-ffff-4fff-8fff-ffffffffffff')", /foreign key|violates/i);
      }, { userId: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
    });

    it("the trusted service role sees all profiles (and nothing else does)", async () => {
      await withTwoProfiles(null, "service_role", async (q) => {
        expect(await q("select id from public.profiles")).toHaveLength(2);
      });
    });

    it("no function callable by the public roles reads profiles (no leak through search or catalogue functions)", async () => {
      const rows = await db.sql<{ proname: string }>("select proname from pg_proc where pronamespace = 'public'::regnamespace and prosrc ilike '%profiles%' and proname not in ('check_profile_types')");
      expect(rows).toEqual([]);
      expect(await db.sql("select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef")).toEqual([]);
    });
  });
});
