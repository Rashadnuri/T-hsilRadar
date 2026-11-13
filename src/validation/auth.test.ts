import { describe, expect, it } from "vitest";
import { parseForgotPassword, parseLogin, parseRegister, parseResetPassword } from "./auth";

const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};
const codes = (r: { ok: boolean; errors?: Record<string, { code: string }> }) => (r.ok ? {} : Object.fromEntries(Object.entries(r.errors!).map(([k, v]) => [k, v.code])));

describe("login", () => {
  it("accepts valid input and normalises the email (trim + lower-case)", () => {
    expect(parseLogin(form({ email: "  Aysel@Example.COM ", password: "x" }))).toEqual({ ok: true, value: { email: "aysel@example.com", password: "x" } });
  });
  it("reports missing and malformed fields with codes (never prose)", () => {
    expect(codes(parseLogin(new FormData()))).toEqual({ email: "required", password: "required" });
    expect(codes(parseLogin(form({ email: "not-an-email", password: "x" })))).toEqual({ email: "invalid_email" });
    expect(codes(parseLogin(form({ email: "a@b.co", password: "" })))).toEqual({ password: "required" });
  });
  it("does not apply the password policy at login (an old password must still work)", () => {
    expect(parseLogin(form({ email: "a@b.co", password: "short" })).ok).toBe(true);
  });
});

describe("register", () => {
  const ok = { fullName: "Aysel Məmmədova", email: "aysel@example.com", password: "correct horse battery", confirmPassword: "correct horse battery" };
  it("accepts valid input", () => {
    const r = parseRegister(form(ok));
    expect(r).toMatchObject({ ok: true, value: { fullName: "Aysel Məmmədova", email: "aysel@example.com" } });
  });
  it("requires every field", () => {
    expect(codes(parseRegister(new FormData()))).toEqual({ fullName: "required", email: "required", password: "required", confirmPassword: "required" });
  });
  it("validates the name: length, HTML", () => {
    expect(codes(parseRegister(form({ ...ok, fullName: "A" })))).toEqual({ fullName: "name_too_short" });
    expect(codes(parseRegister(form({ ...ok, fullName: "<b>Bold</b>" })))).toEqual({ fullName: "html_not_allowed" });
    expect(codes(parseRegister(form({ ...ok, fullName: "x".repeat(121) })))).toEqual({ fullName: "text_too_long" });
  });
  it("enforces the password policy with its parameters", () => {
    const short = parseRegister(form({ ...ok, password: "short", confirmPassword: "short" }));
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.errors.password).toEqual({ code: "password_too_short", params: { min: 10 } });
    const long = parseRegister(form({ ...ok, password: "a".repeat(73), confirmPassword: "a".repeat(73) }));
    if (!long.ok) expect(long.errors.password).toEqual({ code: "password_too_long", params: { max: 72 } });
    expect(parseRegister(form({ ...ok, password: "a".repeat(72), confirmPassword: "a".repeat(72) })).ok).toBe(true);
  });
  it("counts password BYTES, not characters (bcrypt ignores everything past 72 bytes)", () => {
    const emoji = "😀".repeat(19); // 19 characters, 76 bytes
    expect(codes(parseRegister(form({ ...ok, password: emoji, confirmPassword: emoji })))).toEqual({ password: "password_too_long" });
    const azerbaijani = "ə".repeat(36); // 36 characters, 72 bytes
    expect(parseRegister(form({ ...ok, password: azerbaijani, confirmPassword: azerbaijani })).ok).toBe(true);
  });
  it("rejects a password equal to the email, and mismatched confirmation", () => {
    expect(codes(parseRegister(form({ ...ok, email: "someone.long@example.com", password: "someone.long@example.com", confirmPassword: "someone.long@example.com" })))).toEqual({ password: "password_same_as_email" });
    expect(codes(parseRegister(form({ ...ok, confirmPassword: "different password" })))).toEqual({ confirmPassword: "passwords_do_not_match" });
  });
  it("rejects invalid and over-long emails", () => {
    expect(codes(parseRegister(form({ ...ok, email: "nope" })))).toEqual({ email: "invalid_email" });
    expect(codes(parseRegister(form({ ...ok, email: `${"a".repeat(250)}@example.com` })))).toEqual({ email: "invalid_email" });
  });
});

describe("forgot / reset password", () => {
  it("forgot-password validates the email only", () => {
    expect(parseForgotPassword(form({ email: "A@B.co" }))).toEqual({ ok: true, value: { email: "a@b.co" } });
    expect(codes(parseForgotPassword(form({ email: "x" })))).toEqual({ email: "invalid_email" });
  });
  it("reset-password applies the password policy and confirmation", () => {
    expect(parseResetPassword(form({ password: "a-long-new-password", confirmPassword: "a-long-new-password" })).ok).toBe(true);
    expect(codes(parseResetPassword(form({ password: "short", confirmPassword: "short" })))).toEqual({ password: "password_too_short" });
    expect(codes(parseResetPassword(form({ password: "a-long-new-password", confirmPassword: "other" })))).toEqual({ confirmPassword: "passwords_do_not_match" });
  });
});
