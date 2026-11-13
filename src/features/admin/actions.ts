"use server";

import { hasLocale } from "next-intl";
import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/session";
import type { PublicationBlocker } from "@/lib/opportunities/status";
import type { AdminPublicationStatus } from "@/types/admin";
import type { FieldErrors } from "@/validation/messages";
import {
  handleDeleteOpportunity, handleDeleteOrganization, handleReviewTranslation, handleSaveOpportunity, handleSaveOrganization, handleSetStatus, handleSetVerification,
  type AdminContext, type AdminErrorCode,
} from "./handlers";

/**
 * Server Actions of the admin area. Next.js checks the Origin of every action request (CSRF);
 * every handler then verifies the session AND the admin role on the server before touching data.
 */
async function context(): Promise<{ ctx: AdminContext; locale: Locale }> {
  const [{ auth, roles, admin }, requested] = await Promise.all([getAuthContext(), getLocale()]);
  return { ctx: { auth, roles, admin }, locale: hasLocale(routing.locales, requested) ? requested : routing.defaultLocale };
}

const refresh = (locale: Locale) => revalidatePath(`/${locale}/admin`, "layout");

export interface AdminFormState {
  status: "idle" | "success" | "error";
  code?: AdminErrorCode;
  fieldErrors?: FieldErrors;
  blockers?: PublicationBlocker[];
  changed?: string[];
  message?: "saved" | "saved_unverified";
}

export interface AdminActionResult {
  ok: boolean;
  code?: AdminErrorCode;
  blockers?: PublicationBlocker[];
}

export async function saveOpportunityAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  const { ctx, locale } = await context();
  const result = await handleSaveOpportunity(form, ctx);
  if (!result.ok) return { status: "error", code: result.code, fieldErrors: result.fieldErrors, blockers: result.blockers, changed: result.changed };
  refresh(locale);
  if (result.created) redirect({ href: { pathname: `/admin/opportunities/${result.id}/edit`, query: { saved: "1" } }, locale });
  return { status: "success", message: result.unverified ? "saved_unverified" : "saved" };
}

export async function setStatusAction(id: string, status: AdminPublicationStatus): Promise<AdminActionResult> {
  const { ctx, locale } = await context();
  const result = await handleSetStatus(id, status, ctx);
  if (result.ok) refresh(locale);
  return result.ok ? { ok: true } : { ok: false, code: result.code, blockers: result.blockers };
}

export async function setVerificationAction(id: string, verified: boolean): Promise<AdminActionResult> {
  const { ctx, locale } = await context();
  const result = await handleSetVerification(id, verified, ctx);
  if (result.ok) refresh(locale);
  return result.ok ? { ok: true } : { ok: false, code: result.code };
}

export async function reviewTranslationAction(id: string, language: string, status: "human" | "machine_draft" | "machine_approved"): Promise<AdminActionResult> {
  const { ctx, locale } = await context();
  const result = await handleReviewTranslation(id, language, status, ctx);
  if (result.ok) refresh(locale);
  return result.ok ? { ok: true } : { ok: false, code: result.code };
}

export async function deleteOpportunityAction(id: string): Promise<AdminActionResult> {
  const { ctx, locale } = await context();
  const result = await handleDeleteOpportunity(id, ctx);
  if (!result.ok) return { ok: false, code: result.code };
  refresh(locale);
  redirect({ href: { pathname: "/admin/opportunities", query: { deleted: "1" } }, locale });
  return { ok: true };
}

export async function saveOrganizationAction(_previous: AdminFormState, form: FormData): Promise<AdminFormState> {
  const { ctx, locale } = await context();
  const result = await handleSaveOrganization(form, ctx);
  if (!result.ok) return { status: "error", code: result.code, fieldErrors: result.fieldErrors };
  refresh(locale);
  return { status: "success", message: "saved" };
}

export async function deleteOrganizationAction(id: string): Promise<AdminActionResult> {
  const { ctx, locale } = await context();
  const result = await handleDeleteOrganization(id, ctx);
  if (result.ok) refresh(locale);
  return result.ok ? { ok: true } : { ok: false, code: result.code };
}
