import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { AUTH_HINT_COOKIE } from "@/lib/auth/cookies";

const handleI18n = createMiddleware(routing);

/** Pages that need a signed-in user. The authoritative check is in the page (requireUser). */
const PROTECTED = /^\/(az|ru|en)\/(?:profile|my-plan|matches|admin)(?:\/|$)/;

/**
 * Next.js 16 "proxy" (formerly middleware): locale negotiation + an OPTIMISTIC protected-route
 * pre-check. The proxy never trusts the cookie it looks at (it only skips a pointless render for
 * visitors who clearly have no session); every protected page re-verifies the session with the
 * auth server, and the database enforces row level security on top.
 */
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const match = PROTECTED.exec(pathname);
  if (match && !hasAnySessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${match[1]}/login`;
    url.search = `?next=${encodeURIComponent(pathname.slice(3) + request.nextUrl.search)}`;
    const response = NextResponse.redirect(url);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const response = handleI18n(request);
  // Responses of auth-related pages must never be cached by a shared cache (CDN) with cookies.
  if (/^\/(az|ru|en)\/(profile|my-plan|matches|admin|login|register|forgot-password|reset-password|auth)(?:\/|$)/.test(pathname)) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}

/** Supabase stores the session in `sb-<project>-auth-token[.n]`; the dev fake uses `tr-fake-session`. */
function hasAnySessionCookie(request: NextRequest) {
  return request.cookies.getAll().some(({ name }) => /^sb-.+-auth-token/.test(name) || name === "tr-fake-session") || request.cookies.get(AUTH_HINT_COOKIE)?.value === "1";
}

export const config = {
  // Skip API routes, Next internals and any path containing a dot (static files).
  matcher: ["/((?!api|trpc|_next|_vercel|.*\\..*).*)"],
};
