import { afterEach, describe, expect, it, vi } from "vitest";
import { authHintCookie, hardenCookies, SESSION_MAX_AGE_SECONDS } from "./cookies";
import { mapSupabaseAuthError } from "./errors";
import { getAuthMode, isFakeAuthEnabled } from "./mode";
import { safeNextPath } from "./redirects";

describe("safeNextPath (open-redirect protection)", () => {
  it.each([
    ["/profile", "/profile"],
    ["/profile?status=x", "/profile?status=x"],
    ["/opportunities?type=scholarship&scope=azerbaijan", "/opportunities?type=scholarship&scope=azerbaijan"],
    ["/en/opportunities/demo-it-internship", "/opportunities/demo-it-internship"], // locale prefix is stripped; the redirect re-adds the CURRENT locale
    ["/az", "/"],
    ["/ru/profile", "/profile"],
  ])("keeps the safe path %s", (input, expected) => expect(safeNextPath(input)).toBe(expected));

  it.each([
    "https://evil.example", "http://evil.example/profile", "//evil.example", "///evil.example", "/\\evil.example", "\\\\evil.example",
    "javascript:alert(1)", "data:text/html,x", "/profile\nSet-Cookie: x=1", "/profile\r\n", "/\u0000profile", "evil.example/profile", "profile", "",
    "/login", "/login?next=/login", "/register", "/forgot-password", "/auth/callback", "/en/login", "/api/anything", "/_next/static/x",
    `/${"a".repeat(400)}`, "/%2F%2Fevil.example", "/..//evil.example",
  ])("replaces the unsafe value %j with the fallback", (input) => {
    const result = safeNextPath(input);
    expect(result).toBe("/profile");
  });

  it("returns the fallback for non-strings and honours a custom fallback", () => {
    expect(safeNextPath(undefined)).toBe("/profile");
    expect(safeNextPath(null)).toBe("/profile");
    expect(safeNextPath("https://evil.example", "/")).toBe("/");
  });

  it("never returns anything that is not a same-site path", () => {
    for (const attack of ["/%5C%5Cevil", "/\t//evil.example", "/ /evil.example", "/profile#//evil", "/@evil.example"]) {
      const out = safeNextPath(attack);
      expect(out.startsWith("/") && !out.startsWith("//") && !out.includes("\\")).toBe(true);
      expect(new URL(out, "http://site.test").origin).toBe("http://site.test");
    }
  });
});

describe("mapSupabaseAuthError", () => {
  it.each([
    [{ code: "invalid_credentials", status: 400 }, "invalid_credentials"],
    [{ code: "email_not_confirmed", status: 400 }, "email_not_confirmed"],
    [{ code: "user_already_exists", status: 422 }, "registration_failed"], // neutral: no account enumeration
    [{ code: "email_exists", status: 422 }, "registration_failed"],
    [{ code: "weak_password", status: 422 }, "weak_password"],
    [{ code: "same_password", status: 422 }, "same_password"],
    [{ code: "over_request_rate_limit", status: 429 }, "rate_limited"],
    [{ code: "over_email_send_rate_limit", status: 429 }, "rate_limited"],
    [{ status: 429 }, "rate_limited"],
    [{ code: "flow_state_not_found", status: 404 }, "invalid_link"],
    [{ code: "otp_expired", status: 403 }, "invalid_link"],
    [{ code: "bad_code_verifier", status: 400 }, "invalid_link"],
    [{ name: "AuthSessionMissingError", status: 400 }, "session_missing"],
    [{ code: "session_not_found", status: 403 }, "session_missing"],
    [{ name: "AuthRetryableFetchError", status: 0 }, "unavailable"],
    [{ status: 503 }, "unavailable"],
    [{ code: "something_new", status: 418, message: "x" }, "unavailable"],
    [{}, "unavailable"],
  ])("%j → %s", (error, expected) => expect(mapSupabaseAuthError(error)).toBe(expected));
});

describe("the fake auth backend can never run in production", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is enabled only outside production and only when FAKE_AUTH=1", () => {
    expect(isFakeAuthEnabled({ NODE_ENV: "development", FAKE_AUTH: "1" })).toBe(true);
    expect(isFakeAuthEnabled({ NODE_ENV: "test", FAKE_AUTH: "1" })).toBe(true);
    expect(isFakeAuthEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(isFakeAuthEnabled({ NODE_ENV: "production", FAKE_AUTH: "1" })).toBe(false);
  });
  it("auth mode: Supabase wins; production ignores FAKE_AUTH; nothing configured → unconfigured", () => {
    const supabase = { NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value" };
    expect(getAuthMode({ ...supabase, FAKE_AUTH: "1" })).toBe("supabase");
    expect(getAuthMode({ NODE_ENV: "development", FAKE_AUTH: "1" })).toBe("fake");
    expect(getAuthMode({ NODE_ENV: "production", FAKE_AUTH: "1" })).toBe("unconfigured");
    expect(getAuthMode({})).toBe("unconfigured");
    expect(getAuthMode({ NEXT_PUBLIC_SUPABASE_URL: "https://your-project-ref.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "your-anon-key" })).toBe("unconfigured");
  });
  it("the fake module refuses to load when NODE_ENV is production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    await expect(import("./fake/store")).rejects.toThrow(/never be loaded in production/);
  });
});

describe("session cookie hardening", () => {
  it("forces httpOnly, SameSite=Lax, path / and a 14-day lifetime on whatever the auth library asks for", () => {
    const [cookie] = hardenCookies([{ name: "sb-x-auth-token", value: "v", options: { httpOnly: false, sameSite: "none", maxAge: 400 * 86400, path: "/x" } }]);
    expect(cookie!.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    // library-supplied maxAge is kept only because it is explicitly passed; the DEFAULT for new cookies is 14 days
    expect(hardenCookies([{ name: "n", value: "v" }])[0]!.options?.maxAge).toBe(SESSION_MAX_AGE_SECONDS);
  });
  it("keeps clearing cookies clearing (maxAge 0)", () => {
    expect(hardenCookies([{ name: "n", value: "", options: { maxAge: 0 } }])[0]!.options?.maxAge).toBe(0);
  });
  it("is Secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(hardenCookies([{ name: "n", value: "v" }])[0]!.options?.secure).toBe(true);
    vi.unstubAllEnvs();
  });
  it("the UI hint cookie carries no identity and is readable by JavaScript only because it is harmless", () => {
    expect(authHintCookie(true)).toMatchObject({ name: "tr-auth", value: "1", options: { httpOnly: false, sameSite: "lax" } });
    expect(authHintCookie(false)).toMatchObject({ value: "", options: { maxAge: 0 } });
  });
});
