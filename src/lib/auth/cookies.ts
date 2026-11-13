import type { CookieOptionsLike, CookieToSet } from "./types";

/** Sessions last 14 days (the cookie's lifetime; the refresh token is rotated by Supabase Auth). */
export const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

/**
 * A tiny, NON-SENSITIVE cookie ("tr-auth=1") that only tells the browser UI whether to show
 * "Log out" or "Log in", so public pages can stay statically cached. It carries no identity and
 * grants no access: every protected page and action verifies the real session on the server.
 */
export const AUTH_HINT_COOKIE = "tr-auth";

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Session-cookie hardening. @supabase/ssr defaults to httpOnly:false and a 400-day lifetime
 * because its browser client reads the cookie; we have NO browser client, so the session
 * cookies are httpOnly (invisible to JavaScript → not stealable by XSS), SameSite=Lax (not sent on
 * cross-site POSTs), Secure in production, and expire after 14 days.
 */
export function sessionCookieOptions(): CookieOptionsLike {
  return { path: "/", httpOnly: true, sameSite: "lax", secure: isProduction(), maxAge: SESSION_MAX_AGE_SECONDS };
}

/** Applies the hardening to every cookie the auth library wants to write (clearing keeps maxAge 0). */
export function hardenCookies(cookies: CookieToSet[]): CookieToSet[] {
  return cookies.map(({ name, value, options }) => ({
    name,
    value,
    options: { ...sessionCookieOptions(), ...options, httpOnly: true, sameSite: "lax", secure: isProduction(), path: "/" },
  }));
}

export const authHintCookie = (present: boolean): CookieToSet => ({
  name: AUTH_HINT_COOKIE,
  value: present ? "1" : "",
  options: { path: "/", httpOnly: false, sameSite: "lax", secure: isProduction(), maxAge: present ? SESSION_MAX_AGE_SECONDS : 0 },
});
