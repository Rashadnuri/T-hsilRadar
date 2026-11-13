"use server";

import { getLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { redirect } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { authHintCookie } from "@/lib/auth/cookies";
import { getNextCookieJar } from "@/lib/auth/next-cookies";
import { getAuthContext } from "@/lib/auth/session";
import { getSiteUrl } from "@/lib/site";
import { handleForgotPassword, handleLogin, handleLogout, handleRegister, handleResetPassword, handleSaveProfile, type HandlerContext, type HandlerResult } from "./handlers";
import type { FormState } from "./state";

/**
 * Server Actions: the only entry points that change auth state. Next.js checks the Origin
 * header of every Server Action request (CSRF protection), and each action verifies the
 * session on the server — nothing is trusted from the client except the submitted fields.
 */
async function context(): Promise<HandlerContext> {
  const [{ auth, profiles }, requested] = await Promise.all([getAuthContext(), getLocale()]);
  const locale: Locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return { auth, profiles, locale, siteUrl: getSiteUrl() };
}

/** Applies the hint cookie and the redirect (in the visitor's language), or returns the form state. */
async function finish(result: HandlerResult, ctx: HandlerContext): Promise<FormState> {
  if (result.hint !== undefined) (await getNextCookieJar()).setAll([authHintCookie(result.hint)]);
  if (result.redirectTo) redirect({ href: result.redirectTo, locale: ctx.locale });
  return result.state;
}

export async function loginAction(_previous: FormState, form: FormData): Promise<FormState> {
  const ctx = await context();
  return finish(await handleLogin(form, ctx), ctx);
}

export async function registerAction(_previous: FormState, form: FormData): Promise<FormState> {
  const ctx = await context();
  return finish(await handleRegister(form, ctx), ctx);
}

export async function forgotPasswordAction(_previous: FormState, form: FormData): Promise<FormState> {
  const ctx = await context();
  return finish(await handleForgotPassword(form, ctx), ctx);
}

export async function resetPasswordAction(_previous: FormState, form: FormData): Promise<FormState> {
  const ctx = await context();
  return finish(await handleResetPassword(form, ctx), ctx);
}

export async function saveProfileAction(_previous: FormState, form: FormData): Promise<FormState> {
  const ctx = await context();
  return finish(await handleSaveProfile(form, ctx), ctx);
}

/** Logout is a POST (Server Action), never a GET link, so it cannot be triggered by an image tag or prefetch. */
export async function logoutAction(): Promise<void> {
  const ctx = await context();
  await finish(await handleLogout(ctx), ctx);
}
