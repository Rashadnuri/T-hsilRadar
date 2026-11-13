"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/session";
import { getOpportunitiesByIds } from "@/services/opportunities";
import type { ApplicationStatus } from "@/types/plan";
import type { FieldErrors } from "@/validation/messages";
import { handleSetSaved, handleTrack, handleUntrack, handleUpdateApplication, type PlanContext, type PlanErrorCode, type PlanResult } from "./handlers";

/**
 * Server Actions for the personal plan. Next.js checks the Origin header of every action request
 * (CSRF); each action re-verifies the session on the server and derives the owner from it.
 */
async function context(): Promise<PlanContext> {
  const { auth, plan } = await getAuthContext();
  return {
    auth,
    plan,
    isPublicOpportunity: async (id) => (await getOpportunitiesByIds([id])).length === 1,
  };
}

async function refresh() {
  // The plan page is rendered per request; this also drops its client-side router cache entry.
  const locale = await getLocale();
  revalidatePath(`/${locale}/my-plan`);
}

/** What the browser store learns from a toggle: the new truth, or a coarse error code. */
export type ToggleResult = { ok: true } | { ok: false; code: PlanErrorCode };

export async function setSavedAction(opportunityId: string, saved: boolean): Promise<ToggleResult> {
  const result = await handleSetSaved(opportunityId, saved, await context());
  if (result.ok) await refresh();
  return result.ok ? { ok: true } : { ok: false, code: result.code };
}

export type TrackResult = { ok: true; status: ApplicationStatus } | { ok: false; code: PlanErrorCode };

export async function trackAction(opportunityId: string): Promise<TrackResult> {
  const result = await handleTrack(opportunityId, await context());
  if (result.ok) await refresh();
  return result.ok ? { ok: true, status: result.status } : { ok: false, code: result.code };
}

export async function untrackAction(opportunityId: string): Promise<ToggleResult> {
  const result: PlanResult = await handleUntrack(opportunityId, await context());
  if (result.ok) await refresh();
  return result.ok ? { ok: true } : { ok: false, code: result.code };
}

export interface ApplicationFormState {
  status: "idle" | "success" | "error";
  code?: PlanErrorCode;
  fieldErrors?: FieldErrors;
  /** Echoed so a failed save keeps what the person typed (notes are private: only ever sent back to their own browser). */
  saved?: { status: ApplicationStatus; updatedAt: string };
}

export async function updateApplicationAction(_previous: ApplicationFormState, form: FormData): Promise<ApplicationFormState> {
  const result = await handleUpdateApplication(form, await context());
  if (!result.ok) return { status: "error", code: result.code, fieldErrors: result.fieldErrors };
  await refresh();
  return { status: "success", saved: { status: result.status, updatedAt: result.updatedAt } };
}
