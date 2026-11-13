import "server-only";
import { cache } from "react";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { createAuthContext, type AuthContext } from ".";
import { getNextCookieJar } from "./next-cookies";
import { safeNextPath } from "./redirects";
import type { AuthUser } from "./types";

/**
 * The data access layer for authentication (Next.js "DAL" pattern): every protected page and
 * action asks HERE who the user is. The proxy only does optimistic pre-checks; this is the
 * authoritative one, and it verifies the session with the auth server.
 */

/** One context per request (React cache): the auth server is contacted at most once. */
export const getAuthContext = cache(async (): Promise<AuthContext> => createAuthContext(await getNextCookieJar()));

export const getCurrentUser = cache(async (): Promise<AuthUser | null> => (await getAuthContext()).auth.getUser());

/** The verified user, or a redirect to the login page (in the visitor's language, remembering where they were going). */
export async function requireUser(locale: Locale, next = "/profile"): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect({ href: { pathname: "/login", query: { next: safeNextPath(next) } }, locale });
  return user as AuthUser;
}

/** For login/register pages: a signed-in visitor goes to their destination instead. */
export async function redirectIfAuthenticated(locale: Locale, next?: string | null): Promise<void> {
  if (await getCurrentUser()) redirect({ href: safeNextPath(next), locale });
}
