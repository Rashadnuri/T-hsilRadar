import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseProfileRepository } from "@/repositories/profile/supabase-profile-repository";
import { ProfileRepositoryError } from "@/repositories/profile/types";
import { EMPTY_PROFILE_INPUT, type ProfileInput } from "@/types/profile";
import { parseProfileForm } from "@/validation/profile";
import { databaseAvailable, TestDb } from "./helpers";

const available = await databaseAvailable();
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const full: ProfileInput = {
  fullName: "Aysel Məmmədova", educationLevel: "master", university: "Demo University of Technology", academicField: "ict", graduationYear: 2027,
  countryOfResidence: "AZ", preferredCountries: ["DE", "TR"], skills: ["Python", "Public speaking"],
  languages: [{ code: "az", level: "native" }, { code: "en", level: "B2" }], careerInterests: ["Data science"], preferredOpportunityTypes: ["scholarship", "internship"],
};

/** The repository as the application uses it: bound to ONE user's session (RLS role `authenticated` + that user's JWT claims). */
describe.skipIf(!available)("SupabaseProfileRepository under row level security", () => {
  let db: TestDb;
  let alice: SupabaseProfileRepository;
  let bob: SupabaseProfileRepository;

  beforeAll(async () => {
    db = await TestDb.create();
    await db.sql(`insert into auth.users (id, email) values ('${A}', 'alice@example.com'), ('${B}', 'bob@example.com')`);
    alice = new SupabaseProfileRepository(db.client("authenticated", { userId: A }));
    bob = new SupabaseProfileRepository(db.client("authenticated", { userId: B }));
  });
  afterAll(async () => { await db?.drop(); });

  it("returns null before a profile exists, then saves and reads a complete profile (round trip of every field)", async () => {
    expect(await alice.get(A)).toBeNull();
    const saved = await alice.save(A, full);
    expect(saved).toMatchObject({ id: A, ...full });
    expect(saved.createdAt).toBeTruthy();
    expect(await alice.get(A)).toEqual(saved);
  });

  it("saving again replaces the fields (upsert) and keeps created_at", async () => {
    const first = await alice.get(A);
    const second = await alice.save(A, { ...full, fullName: "Aysel M.", skills: [], languages: [], preferredCountries: [] });
    expect(second).toMatchObject({ fullName: "Aysel M.", skills: [], languages: [], preferredCountries: [] });
    expect(second.createdAt).toBe(first!.createdAt);
  });

  it("saves a minimal profile with empty arrays and nulls", async () => {
    const saved = await bob.save(B, { ...EMPTY_PROFILE_INPUT, fullName: "Bob" });
    expect(saved).toMatchObject({ fullName: "Bob", skills: [], languages: [], educationLevel: null, graduationYear: null });
  });

  it("USER ISOLATION: Bob cannot read Alice's profile through the repository", async () => {
    expect(await bob.get(A)).toBeNull(); // RLS hides her row even when her id is asked for explicitly
    expect(await alice.get(B)).toBeNull();
    expect((await bob.get(B))?.fullName).toBe("Bob");
  });

  it("USER ISOLATION: Bob cannot overwrite Alice's profile, even if the application were tricked into trying", async () => {
    const before = await alice.get(A);
    await expect(bob.save(A, { ...full, fullName: "HACKED" })).rejects.toBeInstanceOf(ProfileRepositoryError);
    expect(await alice.get(A)).toEqual(before);
  });

  it("failures never contain profile data (profiles are private)", async () => {
    const error = await bob.save(A, { ...full, fullName: "Very Private Name", university: "Very Private University" }).then(() => null, (e: Error) => e);
    expect(error).toBeInstanceOf(ProfileRepositoryError);
    expect(error!.message).not.toMatch(/Private|Aysel|University/);
  });

  it("anon (no session) cannot read or write profiles at all", async () => {
    const anon = new SupabaseProfileRepository(db.client("anon"));
    await expect(anon.get(A)).rejects.toBeInstanceOf(ProfileRepositoryError);
    await expect(anon.save(A, full)).rejects.toBeInstanceOf(ProfileRepositoryError);
  });

  it("a session without a valid user identity sees nothing and cannot create anything", async () => {
    const ghost = new SupabaseProfileRepository(db.client("authenticated"));
    expect(await ghost.get(A)).toBeNull();
    await expect(ghost.save(A, full)).rejects.toBeInstanceOf(ProfileRepositoryError);
  });

  it("the database refuses what validation should have caught (defence in depth)", async () => {
    await expect(alice.save(A, { ...full, fullName: "<script>x</script>" })).rejects.toBeInstanceOf(ProfileRepositoryError);
    await expect(alice.save(A, { ...full, skills: ["Python", "python"] })).rejects.toBeInstanceOf(ProfileRepositoryError);
    await expect(alice.save(A, { ...full, preferredOpportunityTypes: ["lottery" as never] })).rejects.toBeInstanceOf(ProfileRepositoryError);
    expect((await alice.get(A))?.fullName).toBe("Aysel M."); // unchanged by the failed saves
  });

  it("whatever the form parser accepts, the database accepts (validation and schema agree)", async () => {
    const f = new FormData();
    const entries: [string, string][] = [["fullName", "Leyla Hüseynova"], ["educationLevel", "phd"], ["university", "O'Brien & Sons University"], ["academicField", "health"], ["graduationYear", "2030"],
      ["countryOfResidence", "GE"], ["preferredCountries", "DE"], ["preferredCountries", "US"], ["skills", "R"], ["skills", "Biostatistics"], ["careerInterests", "Public health"],
      ["languageCode", "ka"], ["languageLevel", "native"], ["languageCode", "az"], ["languageLevel", "C1"], ["preferredTypes", "research"], ["preferredTypes", "grant"]];
    for (const [k, v] of entries) f.append(k, v);
    const parsed = parseProfileForm(f, new Date("2026-06-15T00:00:00Z"));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(await alice.save(A, parsed.value)).toMatchObject({ fullName: "Leyla Hüseynova", university: "O'Brien & Sons University", languages: [{ code: "ka", level: "native" }, { code: "az", level: "C1" }] });
  });
});
