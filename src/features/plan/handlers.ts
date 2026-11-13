import type { AuthGateway } from "@/lib/auth/types";
import { PlanRepositoryError, type PlanRepository } from "@/repositories/plan/types";
import type { ApplicationStatus, PlanSnapshot } from "@/types/plan";
import type { FieldErrors } from "@/validation/messages";
import { parseApplicationUpdate, parseOpportunityId } from "@/validation/plan";

/**
 * The logic of every plan operation, free of Next.js (unit-tested with in-memory fakes). Two rules:
 *  1. The owner is ALWAYS the server-verified session user. No user id is accepted from the browser.
 *  2. Saving or tracking only works for opportunities the PUBLIC can see (checked here, and again
 *     by the database policy). Removing and editing never require visibility, so a person can still
 *     clean up or annotate an item that has since been unpublished.
 */
export interface PlanContext {
  auth: AuthGateway;
  plan: PlanRepository | null;
  /** True when the opportunity is publicly visible (published, verified or demo, expired included). */
  isPublicOpportunity(id: string): Promise<boolean>;
}

export type PlanErrorCode = "unauthorized" | "not_found" | "limit" | "failed" | "invalid";
export type PlanResult<T = object> = ({ ok: true } & T) | { ok: false; code: PlanErrorCode; fieldErrors?: FieldErrors };

const fail = (code: PlanErrorCode, fieldErrors?: FieldErrors): { ok: false; code: PlanErrorCode; fieldErrors?: FieldErrors } => ({ ok: false, code, ...(fieldErrors ? { fieldErrors } : {}) });

function codeOf(error: unknown): PlanErrorCode {
  if (error instanceof PlanRepositoryError) return error.reason === "not_visible" ? "not_found" : error.reason === "limit" ? "limit" : "failed";
  return "failed";
}

async function withUser(ctx: PlanContext): Promise<{ userId: string; plan: PlanRepository } | null> {
  const user = await ctx.auth.getUser();
  return user && ctx.plan ? { userId: user.id, plan: ctx.plan } : null;
}

export async function handleSnapshot(ctx: PlanContext): Promise<PlanResult<{ snapshot: PlanSnapshot }>> {
  const session = await withUser(ctx);
  if (!session) return fail("unauthorized");
  try {
    const [saved, applications] = await Promise.all([session.plan.listSaved(session.userId), session.plan.listApplications(session.userId)]);
    return { ok: true, snapshot: { saved: saved.map((s) => s.opportunityId), applications: Object.fromEntries(applications.map((a) => [a.opportunityId, a.status])) } };
  } catch (error) {
    return fail(codeOf(error));
  }
}

export async function handleSetSaved(rawId: unknown, saved: boolean, ctx: PlanContext): Promise<PlanResult<{ saved: boolean }>> {
  const opportunityId = parseOpportunityId(rawId);
  if (!opportunityId) return fail("invalid");
  const session = await withUser(ctx);
  if (!session) return fail("unauthorized");
  try {
    if (saved) {
      if (!(await ctx.isPublicOpportunity(opportunityId))) return fail("not_found");
      await session.plan.save(session.userId, opportunityId);
    } else {
      await session.plan.unsave(session.userId, opportunityId);
    }
    return { ok: true, saved };
  } catch (error) {
    return fail(codeOf(error));
  }
}

export async function handleTrack(rawId: unknown, ctx: PlanContext): Promise<PlanResult<{ status: ApplicationStatus }>> {
  const opportunityId = parseOpportunityId(rawId);
  if (!opportunityId) return fail("invalid");
  const session = await withUser(ctx);
  if (!session) return fail("unauthorized");
  try {
    if (!(await ctx.isPublicOpportunity(opportunityId))) return fail("not_found");
    const application = await session.plan.track(session.userId, opportunityId);
    return { ok: true, status: application.status };
  } catch (error) {
    return fail(codeOf(error));
  }
}

export async function handleUntrack(rawId: unknown, ctx: PlanContext): Promise<PlanResult> {
  const opportunityId = parseOpportunityId(rawId);
  if (!opportunityId) return fail("invalid");
  const session = await withUser(ctx);
  if (!session) return fail("unauthorized");
  try {
    await session.plan.untrack(session.userId, opportunityId);
    return { ok: true };
  } catch (error) {
    return fail(codeOf(error));
  }
}

/** Status + personal notes of one application, from the application form. */
export async function handleUpdateApplication(form: FormData, ctx: PlanContext): Promise<PlanResult<{ status: ApplicationStatus; notes: string | null; updatedAt: string }>> {
  const session = await withUser(ctx);
  if (!session) return fail("unauthorized");
  const parsed = parseApplicationUpdate(form);
  if (!parsed.ok) return fail("invalid", parsed.errors);
  try {
    const updated = await session.plan.updateApplication(session.userId, parsed.value.opportunityId, { status: parsed.value.status, notes: parsed.value.notes });
    if (!updated) return fail("not_found");
    return { ok: true, status: updated.status, notes: updated.notes, updatedAt: updated.updatedAt };
  } catch (error) {
    // Details are intentionally dropped: notes are private and must not end up in logs.
    return fail(codeOf(error));
  }
}
