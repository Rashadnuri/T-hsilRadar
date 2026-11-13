import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FAKE_SESSION_COOKIE, createFakeAuth } from "@/lib/auth/fake/gateway";
import { fakeState, MAX_FAILED_LOGINS } from "@/lib/auth/fake/store";
import type { CookieJar } from "@/lib/auth/types";
import { handleForgotPassword, handleLogin, handleLogout, handleRegister, handleResetPassword, handleSaveProfile, type HandlerContext } from "./handlers";

/** A browser's cookie jar. */
function jar(): CookieJar & { names(): string[] } {
  const store = new Map<string, string>();
  return {
    getAll: () => [...store].map(([name, value]) => ({ name, value })),
    setAll: (cookies) => cookies.forEach(({ name, value, options }) => (options?.maxAge === 0 || value === "" ? store.delete(name) : store.set(name, value))),
    names: () => [...store.keys()],
  };
}
/** One browser = one jar + gateway + repository. */
function browser(locale: "az" | "ru" | "en" = "en") {
  const j = jar();
  const { auth, profiles } = createFakeAuth(j);
  const ctx: HandlerContext = { auth, profiles, locale, siteUrl: "https://tahsilradar.test", now: new Date("2026-06-15T00:00:00Z") };
  return { jar: j, auth, profiles, ctx };
}
const form = (values: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  return f;
};
const PW = "correct horse battery";
const reg = (email: string, extra: Record<string, string> = {}) => form({ fullName: "Aysel Məmmədova", email, password: PW, confirmPassword: PW, ...extra });

let mailbox: string;
const mails = () => readFileSync(mailbox, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; kind: string; link: string });
const codeOf = (link: string) => new URL(link).searchParams.get("code")!;

beforeAll(() => {
  mailbox = join(mkdtempSync(join(tmpdir(), "tr-mail-")), "mailbox.jsonl");
  process.env.FAKE_AUTH_MAILBOX_FILE = mailbox;
});
beforeEach(() => {
  for (const m of Object.values(fakeState)) (m as Map<unknown, unknown>).clear();
  writeFileSync(mailbox, "");
  delete process.env.FAKE_AUTH_CONFIRM_EMAIL;
});

describe("registration", () => {
  it("creates the account, signs the user in and sends them to their profile", async () => {
    const b = browser();
    const r = await handleRegister(reg("aysel@example.com"), b.ctx);
    expect(r).toMatchObject({ redirectTo: "/profile", hint: true, state: { status: "success" } });
    expect(b.jar.names()).toContain(FAKE_SESSION_COOKIE);
    expect((await b.auth.getUser())?.email).toBe("aysel@example.com");
  });

  it("returns field errors as CODES and never echoes the password", async () => {
    const b = browser();
    const r = await handleRegister(form({ fullName: "A", email: "bad", password: "s3cretPw", confirmPassword: "otherS3cret" }), b.ctx);
    expect(r.state.status).toBe("error");
    expect(r.state.fieldErrors).toMatchObject({ fullName: { code: "name_too_short" }, email: { code: "invalid_email" }, password: { code: "password_too_short", params: { min: 10 } } });
    expect(r.state.values).toEqual({ fullName: "A", email: "bad" });
    expect(JSON.stringify(r)).not.toContain("s3cretPw"); // neither password value ever comes back
    expect(JSON.stringify(r)).not.toContain("otherS3cret");
    expect(r.redirectTo).toBeUndefined();
  });

  it("an existing account gets a generic failure (no enumeration), and a weak password is reported", async () => {
    const b = browser();
    await handleRegister(reg("dup@example.com"), b.ctx);
    const again = await handleRegister(reg("dup@example.com"), browser().ctx);
    expect(again.state).toMatchObject({ status: "error", formError: "registration_failed" });
    const weak = await handleRegister(form({ fullName: "Aysel M", email: "w@example.com", password: "password1234", confirmPassword: "password1234" }), browser().ctx);
    expect(weak.state.formError).toBe("weak_password");
  });

  describe("with email confirmation required", () => {
    beforeEach(() => { process.env.FAKE_AUTH_CONFIRM_EMAIL = "1"; });

    it("does not sign in; sends a confirmation link that stays in the visitor's language", async () => {
      const b = browser("ru");
      const r = await handleRegister(reg("c@example.com"), b.ctx);
      expect(r).toMatchObject({ state: { status: "success", message: "check_email" } });
      expect(r.redirectTo).toBeUndefined();
      expect(b.jar.names()).not.toContain(FAKE_SESSION_COOKIE);
      const [mail] = mails();
      expect(mail).toMatchObject({ to: "c@example.com", kind: "confirm" });
      expect(mail!.link).toMatch(/^https:\/\/tahsilradar\.test\/ru\/auth\/callback\?next=%2Fprofile&code=/);
    });
    it("login is refused until the address is confirmed; the emailed code then signs the user in once", async () => {
      const b = browser();
      await handleRegister(reg("c@example.com"), b.ctx);
      expect((await handleLogin(form({ email: "c@example.com", password: PW }), b.ctx)).state.formError).toBe("email_not_confirmed");
      const code = codeOf(mails()[0]!.link);
      expect((await b.auth.exchangeCode(code)).ok).toBe(true);
      expect((await b.auth.getUser())?.email).toBe("c@example.com");
      expect(await browser().auth.exchangeCode(code)).toEqual({ ok: false, code: "invalid_link" }); // one-time
    });
    it("registering an existing address looks exactly like a first registration", async () => {
      await handleRegister(reg("same@example.com"), browser().ctx);
      const second = await handleRegister(reg("same@example.com"), browser().ctx);
      expect(second.state).toMatchObject({ status: "success", message: "check_email" });
    });
  });
});

describe("login", () => {
  it("signs in and redirects to a safe destination", async () => {
    const owner = browser();
    await handleRegister(reg("l@example.com"), owner.ctx);
    const b = browser();
    const r = await handleLogin(form({ email: " L@Example.com ", password: PW, next: "/opportunities?type=grant" }), b.ctx);
    expect(r).toMatchObject({ redirectTo: "/opportunities?type=grant", hint: true });
    expect(b.jar.names()).toContain(FAKE_SESSION_COOKIE);
  });
  it.each(["https://evil.example/steal", "//evil.example", "/login", "javascript:alert(1)"])("ignores the malicious next=%s", async (next) => {
    await handleRegister(reg("l@example.com"), browser().ctx);
    expect((await handleLogin(form({ email: "l@example.com", password: PW, next }), browser().ctx)).redirectTo).toBe("/profile");
  });
  it("unknown e-mail and wrong password are indistinguishable", async () => {
    await handleRegister(reg("l@example.com"), browser().ctx);
    const wrong = await handleLogin(form({ email: "l@example.com", password: "wrong password!" }), browser().ctx);
    const unknown = await handleLogin(form({ email: "nobody@example.com", password: "wrong password!" }), browser().ctx);
    expect(wrong.state).toEqual({ status: "error", formError: "invalid_credentials", values: { email: "l@example.com" } });
    expect(unknown.state.formError).toBe("invalid_credentials");
  });
  it("is rate-limited after repeated failures, even for the right password", async () => {
    await handleRegister(reg("l@example.com"), browser().ctx);
    const b = browser();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await handleLogin(form({ email: "l@example.com", password: "nope nope nope" }), b.ctx);
    expect((await handleLogin(form({ email: "l@example.com", password: PW }), b.ctx)).state.formError).toBe("rate_limited");
  });
  it("validates fields before calling the auth server", async () => {
    const r = await handleLogin(form({ email: "x", password: "" }), browser().ctx);
    expect(r.state.fieldErrors).toMatchObject({ email: { code: "invalid_email" }, password: { code: "required" } });
  });
});

describe("password reset", () => {
  it("answers identically for existing and unknown accounts, and only emails existing ones", async () => {
    await handleRegister(reg("r@example.com"), browser().ctx);
    writeFileSync(mailbox, "");
    const known = await handleForgotPassword(form({ email: "r@example.com" }), browser("az").ctx);
    const unknown = await handleForgotPassword(form({ email: "ghost@example.com" }), browser("az").ctx);
    expect(known.state).toMatchObject({ status: "success", message: "reset_sent" });
    expect(unknown.state).toMatchObject({ status: "success", message: "reset_sent" });
    expect(mails()).toHaveLength(1);
    expect(mails()[0]!.link).toMatch(/^https:\/\/tahsilradar\.test\/az\/auth\/callback\?next=%2Freset-password&code=/);
  });
  it("the full flow: link → new password → old password stops working", async () => {
    await handleRegister(reg("r@example.com"), browser().ctx);
    writeFileSync(mailbox, "");
    await handleForgotPassword(form({ email: "r@example.com" }), browser().ctx);
    const b = browser();
    expect((await b.auth.exchangeCode(codeOf(mails()[0]!.link))).ok).toBe(true);
    const NEW = "an entirely new password";
    const r = await handleResetPassword(form({ password: NEW, confirmPassword: NEW }), b.ctx);
    expect(r).toMatchObject({ redirectTo: "/profile?status=password_updated", hint: true });
    expect((await handleLogin(form({ email: "r@example.com", password: PW }), browser().ctx)).state.formError).toBe("invalid_credentials");
    expect((await handleLogin(form({ email: "r@example.com", password: NEW }), browser().ctx)).redirectTo).toBe("/profile");
  });
  it("setting a password without the recovery session is refused", async () => {
    const r = await handleResetPassword(form({ password: "an entirely new password", confirmPassword: "an entirely new password" }), browser().ctx);
    expect(r.state).toEqual({ status: "error", formError: "session_missing" });
  });
  it("rejects the same, weak and mismatched passwords", async () => {
    const b = browser();
    await handleRegister(reg("r@example.com"), b.ctx); // signed in
    expect((await handleResetPassword(form({ password: PW, confirmPassword: PW }), b.ctx)).state.formError).toBe("same_password");
    expect((await handleResetPassword(form({ password: "password1234", confirmPassword: "password1234" }), b.ctx)).state.formError).toBe("weak_password");
    expect((await handleResetPassword(form({ password: "long enough password", confirmPassword: "different one!!" }), b.ctx)).state.fieldErrors).toMatchObject({ confirmPassword: { code: "passwords_do_not_match" } });
  });
});

describe("logout", () => {
  it("ends the session and clears the UI hint; the visitor is sent to the home page", async () => {
    const b = browser();
    await handleRegister(reg("o@example.com"), b.ctx);
    expect(await b.auth.getUser()).not.toBeNull();
    expect(await handleLogout(b.ctx)).toMatchObject({ redirectTo: "/", hint: false });
    expect(await b.auth.getUser()).toBeNull();
    expect(b.jar.names()).not.toContain(FAKE_SESSION_COOKIE);
  });
  it("a copied session cookie stops working after logout (server-side revocation)", async () => {
    const b = browser();
    await handleRegister(reg("o@example.com"), b.ctx);
    const stolen = b.jar.getAll().find((c) => c.name === FAKE_SESSION_COOKIE)!;
    const thief = jar();
    thief.setAll([{ name: stolen.name, value: stolen.value }]);
    const attacker = createFakeAuth(thief);
    expect(await attacker.auth.getUser()).not.toBeNull(); // valid while the session is alive
    await handleLogout(b.ctx);
    expect(await attacker.auth.getUser()).toBeNull();
  });
});

describe("profile: authorization and isolation", () => {
  const profileForm = (extra: Record<string, string | string[]> = {}) => form({ fullName: "Aysel Məmmədova", university: "Demo University", educationLevel: "bachelor", skills: ["Python"], ...extra });

  it("requires a signed-in user", async () => {
    const b = browser();
    expect((await handleSaveProfile(profileForm(), b.ctx)).state).toEqual({ status: "error", formError: "session_missing" });
  });
  it("saves the profile of the session user and reports success", async () => {
    const b = browser();
    await handleRegister(reg("p@example.com"), b.ctx);
    const user = (await b.auth.getUser())!;
    expect((await handleSaveProfile(profileForm({ graduationYear: "2027" }), b.ctx)).state).toEqual({ status: "success", message: "saved" });
    expect(await b.profiles.get(user.id)).toMatchObject({ id: user.id, fullName: "Aysel Məmmədova", university: "Demo University", graduationYear: 2027, skills: ["Python"] });
  });
  it("returns field errors as codes and saves nothing when invalid", async () => {
    const b = browser();
    await handleRegister(reg("p@example.com"), b.ctx);
    const user = (await b.auth.getUser())!;
    const r = await handleSaveProfile(profileForm({ graduationYear: "1800", countryOfResidence: "XX" }), b.ctx);
    expect(r.state.formError).toBe("form_invalid");
    expect(r.state.fieldErrors).toMatchObject({ graduationYear: { code: "invalid_year" }, countryOfResidence: { code: "invalid_country" } });
    expect(await b.profiles.get(user.id)).toBeNull();
  });
  it("USER ISOLATION: the target is always the session user; an id smuggled into the form is ignored", async () => {
    const alice = browser();
    const bob = browser();
    await handleRegister(reg("alice@example.com"), alice.ctx);
    await handleRegister(reg("bob@example.com"), bob.ctx);
    const [a, b] = [(await alice.auth.getUser())!, (await bob.auth.getUser())!];
    await handleSaveProfile(profileForm({ fullName: "Bob Private", id: a.id, userId: a.id, user_id: a.id }), bob.ctx);
    expect(await bob.profiles.get(b.id)).toMatchObject({ fullName: "Bob Private" });
    expect(await alice.profiles.get(a.id)).toBeNull(); // Alice's profile was not touched
    await handleSaveProfile(profileForm({ fullName: "Alice Private" }), alice.ctx);
    expect((await alice.profiles.get(a.id))?.fullName).toBe("Alice Private");
    expect((await bob.profiles.get(b.id))?.fullName).toBe("Bob Private");
  });
  it("an unconfigured profile store fails closed", async () => {
    const b = browser();
    await handleRegister(reg("p@example.com"), b.ctx);
    expect((await handleSaveProfile(profileForm(), { ...b.ctx, profiles: null })).state.formError).toBe("unauthorized");
  });
  it("a storage failure is reported generically without leaking details", async () => {
    const b = browser();
    await handleRegister(reg("p@example.com"), b.ctx);
    const failing = { get: async () => null, save: async () => { throw new Error("db exploded: secret details"); } };
    const r = await handleSaveProfile(profileForm(), { ...b.ctx, profiles: failing });
    expect(r.state).toEqual({ status: "error", formError: "save_failed" });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});
