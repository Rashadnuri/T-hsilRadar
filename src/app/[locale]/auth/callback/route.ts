import { hasLocale } from "next-intl";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { authHintCookie } from "@/lib/auth/cookies";
import { getNextCookieJar } from "@/lib/auth/next-cookies";
import { safeNextPath } from "@/lib/auth/redirects";
import { getAuthContext } from "@/lib/auth/session";

/**
 * Landing point of the links in confirmation / password-reset emails (PKCE flow): the one-time
 * `code` is exchanged for a session on the server, then the visitor continues in THEIR language.
 * Any failure sends them to the login page with a neutral error — never to a page that echoes the code.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale: requested } = await params;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  // Reset-password is a legitimate target here (it is not an "auth page" for safeNextPath purposes).
  const next = safeNextPath(url.searchParams.get("next"));

  const redirectTo = (path: string) => {
    const response = NextResponse.redirect(new URL(`/${locale}${path === "/" ? "" : path}`, url.origin), 303);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };

  if (!code || code.length > 2048) return redirectTo("/login?error=invalid_link");
  const { auth } = await getAuthContext();
  const result = await auth.exchangeCode(code);
  if (!result.ok) return redirectTo("/login?error=invalid_link");

  (await getNextCookieJar()).setAll([authHintCookie(true)]);
  return redirectTo(next);
}
