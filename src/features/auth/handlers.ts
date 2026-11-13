import type { Locale } from "@/i18n/routing";
import { safeNextPath } from "@/lib/auth/redirects";
import type { AuthGateway } from "@/lib/auth/types";
import type { ProfileRepository } from "@/repositories/profile/types";
import { parseForgotPassword, parseLogin, parseRegister, parseResetPassword } from "@/validation/auth";
import { parseProfileForm } from "@/validation/profile";
import type { FormState } from "./state";

/**
 * The logic of every auth/profile flow, free of Next.js: validate → call the gateway → decide
 * what the browser should do next. The server actions (actions.ts) only add cookies and the
 * actual redirect, so all of this is unit-tested with a fake gateway.
 */
export interface HandlerContext {
  auth: AuthGateway;
  locale: Locale;
  /** Public origin for links inside emails, e.g. https://tahsilradar.example */
  siteUrl: string;
  profiles?: ProfileRepository | null;
  now?: Date;
}

export interface HandlerResult {
  state: FormState;
  /** Locale-less path to redirect to (the action re-applies the visitor's locale). */
  redirectTo?: string;
  /** Set (true) or clear (false) the non-sensitive "signed in" UI hint cookie. */
  hint?: boolean;
}

const callback = (ctx: HandlerContext, next: string) => `${ctx.siteUrl}/${ctx.locale}/auth/callback?next=${encodeURIComponent(next)}`;
const str = (form: FormData, name: string) => (typeof form.get(name) === "string" ? (form.get(name) as string) : "");

export async function handleLogin(form: FormData, ctx: HandlerContext): Promise<HandlerResult> {
  const values = { email: str(form, "email").trim() };
  const parsed = parseLogin(form);
  if (!parsed.ok) return { state: { status: "error", fieldErrors: parsed.errors, values } };

  const result = await ctx.auth.signIn(parsed.value.email, parsed.value.password);
  if (!result.ok) return { state: { status: "error", formError: result.code, values } };
  return { state: { status: "success" }, redirectTo: safeNextPath(str(form, "next")), hint: true };
}

export async function handleRegister(form: FormData, ctx: HandlerContext): Promise<HandlerResult> {
  const values = { fullName: str(form, "fullName").trim(), email: str(form, "email").trim() };
  const parsed = parseRegister(form);
  if (!parsed.ok) return { state: { status: "error", fieldErrors: parsed.errors, values } };

  const { email, password, fullName } = parsed.value;
  const result = await ctx.auth.signUp({ email, password, fullName, locale: ctx.locale, redirectTo: callback(ctx, "/profile") });
  if (!result.ok) return { state: { status: "error", formError: result.code, values } };
  if (result.data.needsEmailConfirmation) return { state: { status: "success", message: "check_email", values: { email } } };
  return { state: { status: "success" }, redirectTo: "/profile", hint: true };
}

export async function handleForgotPassword(form: FormData, ctx: HandlerContext): Promise<HandlerResult> {
  const values = { email: str(form, "email").trim() };
  const parsed = parseForgotPassword(form);
  if (!parsed.ok) return { state: { status: "error", fieldErrors: parsed.errors, values } };

  const result = await ctx.auth.requestPasswordReset(parsed.value.email, callback(ctx, "/reset-password"));
  if (!result.ok) return { state: { status: "error", formError: result.code, values } };
  // The same confirmation whether or not an account exists.
  return { state: { status: "success", message: "reset_sent", values: { email: parsed.value.email } } };
}

export async function handleResetPassword(form: FormData, ctx: HandlerContext): Promise<HandlerResult> {
  // Setting a password needs a session: the recovery session created by the emailed link.
  if (!(await ctx.auth.getUser())) return { state: { status: "error", formError: "session_missing" } };
  const parsed = parseResetPassword(form);
  if (!parsed.ok) return { state: { status: "error", fieldErrors: parsed.errors } };

  const result = await ctx.auth.updatePassword(parsed.value.password);
  if (!result.ok) return { state: { status: "error", formError: result.code } };
  return { state: { status: "success" }, redirectTo: "/profile?status=password_updated", hint: true };
}

export async function handleLogout(ctx: HandlerContext): Promise<HandlerResult> {
  await ctx.auth.signOut();
  return { state: { status: "success" }, redirectTo: "/", hint: false };
}

/**
 * Saves the profile of the signed-in user. The owner is ALWAYS the server-verified session
 * user: no id is read from the form, so a forged request cannot target someone else's profile
 * (and row level security would refuse it anyway).
 */
export async function handleSaveProfile(form: FormData, ctx: HandlerContext): Promise<HandlerResult> {
  const user = await ctx.auth.getUser();
  if (!user || !ctx.profiles) return { state: { status: "error", formError: user ? "unauthorized" : "session_missing" } };

  const parsed = parseProfileForm(form, ctx.now);
  if (!parsed.ok) return { state: { status: "error", formError: "form_invalid", fieldErrors: parsed.errors } };

  try {
    await ctx.profiles.save(user.id, parsed.value);
  } catch {
    // Details are intentionally dropped: profile data is private and must not end up in logs.
    return { state: { status: "error", formError: "save_failed" } };
  }
  return { state: { status: "success", message: "saved" } };
}
