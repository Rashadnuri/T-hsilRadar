"use server";

import { hasLocale } from "next-intl";
import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { routing, type Locale } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/session";
import type { FieldErrors } from "@/validation/messages";
import type { AdminContext, AdminErrorCode } from "./handlers";
import {
  handleDeleteSource, handleExpireCheck, handleImportCommit, handleImportPreview, handleMarkSourceChecked, handleSaveSource,
  type ImportCommitResult, type ImportPreviewView,
} from "./import-handlers";

/** Server Actions for sources, CSV import and data quality. Origin-checked by Next.js; every handler authorizes first. */
async function context(): Promise<{ ctx: AdminContext; locale: Locale }> {
  const [{ auth, roles, admin }, requested] = await Promise.all([getAuthContext(), getLocale()]);
  return { ctx: { auth, roles, admin }, locale: hasLocale(routing.locales, requested) ? requested : routing.defaultLocale };
}
const refresh = (locale: Locale) => revalidatePath(`/${locale}/admin`, "layout");

export interface SourceFormState {
  status: "idle" | "success" | "error";
  code?: AdminErrorCode;
  fieldErrors?: FieldErrors;
}

export async function saveSourceAction(_previous: SourceFormState, form: FormData): Promise<SourceFormState> {
  const { ctx, locale } = await context();
  const result = await handleSaveSource(form, ctx);
  if (!result.ok) return { status: "error", code: result.code, fieldErrors: "fieldErrors" in result ? result.fieldErrors : undefined };
  refresh(locale);
  return { status: "success" };
}

export async function markSourceCheckedAction(id: string): Promise<{ ok: boolean; code?: AdminErrorCode }> {
  const { ctx, locale } = await context();
  const result = await handleMarkSourceChecked(id, ctx);
  if (result.ok) refresh(locale);
  return result.ok ? { ok: true } : { ok: false, code: result.code };
}

export async function deleteSourceAction(id: string): Promise<{ ok: boolean; code?: AdminErrorCode }> {
  const { ctx, locale } = await context();
  const result = await handleDeleteSource(id, ctx);
  if (result.ok) refresh(locale);
  return result.ok ? { ok: true } : { ok: false, code: result.code };
}

export async function importPreviewAction(csv: string): Promise<{ ok: true; preview: ImportPreviewView } | { ok: false; code: AdminErrorCode }> {
  const { ctx } = await context();
  return handleImportPreview(csv, ctx);
}

export async function importCommitAction(csv: string, includePossibleDuplicates: boolean): Promise<ImportCommitResult | { ok: false; code: AdminErrorCode }> {
  const { ctx, locale } = await context();
  const result = await handleImportCommit(csv, { includePossibleDuplicates }, ctx);
  if (result.ok) refresh(locale);
  return result;
}

export async function expireCheckAction(): Promise<{ ok: true; flagged: number } | { ok: false; code: AdminErrorCode }> {
  const { ctx, locale } = await context();
  const result = await handleExpireCheck(ctx);
  if (result.ok) refresh(locale);
  return result;
}
