import { applyInputToRecord } from "@/lib/admin/apply-input";
import type { AuthGateway, AuthUser } from "@/lib/auth/types";
import { canTransitionPublication, changedCriticalFields, getPublicationBlockers, type PublicationBlocker } from "@/lib/opportunities/status";
import { AdminRepositoryError, type AdminRepository, type RoleRepository } from "@/repositories/admin/types";
import { ADMIN_PUBLICATION_STATUSES, type AdminPublicationStatus } from "@/types/admin";
import type { FieldErrors } from "@/validation/messages";
import { parseOpportunityForm, parseOrganizationForm } from "@/validation/admin";
import { parseOpportunityId } from "@/validation/plan";

/**
 * The logic of every admin operation, free of Next.js (unit-tested with in-memory fakes). The first
 * thing EVERY handler does is `authorize`: the session user is verified on the server and their
 * role is read from the database. Nothing here trusts the browser, the route, or "the button was hidden".
 */
export interface AdminContext {
  auth: AuthGateway;
  roles: RoleRepository | null;
  admin: AdminRepository | null;
  now?: Date;
}

export type AdminErrorCode =
  | "unauthorized" | "forbidden" | "not_found" | "invalid" | "conflict" | "in_use" | "publish_blocked" | "failed"
  | "invalid_transition" | "archive_first" | "unpublish_first" | "critical_change_published" | "missing_official_source";

export type AdminResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; code: AdminErrorCode; fieldErrors?: FieldErrors; blockers?: PublicationBlocker[]; changed?: string[] };

/** The verifier id is hidden from the API; the database enforces it at publish time. */
const ADMIN_VIEW = { verifierReadable: false } as const;

const fail = (code: AdminErrorCode, extra: { fieldErrors?: FieldErrors; blockers?: PublicationBlocker[]; changed?: string[] } = {}) => ({ ok: false as const, code, ...extra });

/** Signed in (verified with the auth server) AND holding the admin role (read from the database). */
export async function authorize(ctx: AdminContext): Promise<{ user: AuthUser; admin: AdminRepository } | { error: AdminErrorCode }> {
  const user = await ctx.auth.getUser();
  if (!user) return { error: "unauthorized" };
  if (!ctx.roles || !ctx.admin) return { error: "forbidden" };
  let roles;
  try {
    roles = await ctx.roles.getRoles(user.id);
  } catch {
    return { error: "forbidden" }; // fail closed
  }
  return roles.includes("admin") ? { user, admin: ctx.admin } : { error: "forbidden" };
}

function codeOf(error: unknown): AdminErrorCode {
  if (!(error instanceof AdminRepositoryError)) return "failed";
  switch (error.reason) {
    case "forbidden": return "forbidden";
    case "not_found": return "not_found";
    case "conflict": return "conflict";
    case "in_use": return "in_use";
    case "publish_blocked": return "publish_blocked";
    case "invalid": return "invalid";
    default: return "failed";
  }
}

export async function handleSaveOpportunity(form: FormData, ctx: AdminContext): Promise<AdminResult<{ id: string; created: boolean; unverified: boolean }>> {
  const auth = await authorize(ctx);
  if ("error" in auth) return fail(auth.error);
  const { admin } = auth;

  const rawId = typeof form.get("id") === "string" ? (form.get("id") as string).trim() : "";
  const id = rawId ? parseOpportunityId(rawId) : null;
  if (rawId && !id) return fail("invalid");
  try {
    const existing = id ? await admin.get(id) : null;
    if (id && !existing) return fail("not_found");

    const parsed = parseOpportunityForm(form, {
      existingLanguages: existing?.translations.filter((t) => t.status !== "original").map((t) => t.language),
      existingOriginalLanguage: existing?.originalLanguage,
    });
    if (!parsed.ok) return fail("invalid", { fieldErrors: parsed.errors });
    const input = { ...parsed.value, ...(id ? { id } : {}) };

    let unverify = false;
    if (existing) {
      const next = applyInputToRecord(existing, input);
      // A published record must keep meeting the publishing requirements after the edit.
      if (existing.publicationStatus === "published") {
        const blockers = getPublicationBlockers(next, ctx.now, ADMIN_VIEW).filter((b) => b !== "already_expired" && b !== "not_verified");
        if (blockers.length > 0) return fail("publish_blocked", { blockers });
      }
      // Changing facts the verification vouched for withdraws the verification (SECURITY.md §5).
      if (existing.verificationStatus === "verified" && !existing.isDemo) {
        const changed = changedCriticalFields(existing, next);
        if (changed.length > 0) {
          if (existing.publicationStatus === "published") return fail("critical_change_published", { changed });
          unverify = true;
        }
      }
    }

    const savedId = await admin.save(input);
    if (unverify) await admin.setVerification(savedId, false);
    return { ok: true, id: savedId, created: !existing, unverified: unverify };
  } catch (error) {
    return fail(codeOf(error)); // details are dropped on purpose: drafts are not public
  }
}

export async function handleSetStatus(rawId: unknown, target: unknown, ctx: AdminContext): Promise<AdminResult<{ status: AdminPublicationStatus }>> {
  const auth = await authorize(ctx);
  if ("error" in auth) return fail(auth.error);
  const id = parseOpportunityId(rawId);
  if (!id || typeof target !== "string" || !(ADMIN_PUBLICATION_STATUSES as readonly string[]).includes(target)) return fail("invalid");
  const status = target as AdminPublicationStatus;
  try {
    const record = await auth.admin.get(id);
    if (!record) return fail("not_found");
    if (!canTransitionPublication(record.publicationStatus, status)) return fail("invalid_transition");
    if (status === "published") {
      const blockers = getPublicationBlockers(record, ctx.now, ADMIN_VIEW);
      if (blockers.length > 0) return fail("publish_blocked", { blockers });
    }
    await auth.admin.setPublicationStatus(id, status);
    return { ok: true, status };
  } catch (error) {
    return fail(codeOf(error));
  }
}

export async function handleSetVerification(rawId: unknown, verified: boolean, ctx: AdminContext): Promise<AdminResult<{ verified: boolean }>> {
  const auth = await authorize(ctx);
  if ("error" in auth) return fail(auth.error);
  const id = parseOpportunityId(rawId);
  if (!id) return fail("invalid");
  try {
    const record = await auth.admin.get(id);
    if (!record) return fail("not_found");
    if (verified && !record.officialSourceUrl) return fail("missing_official_source");
    if (!verified && record.publicationStatus === "published" && !record.isDemo) return fail("unpublish_first");
    await auth.admin.setVerification(id, verified);
    return { ok: true, verified };
  } catch (error) {
    return fail(codeOf(error));
  }
}

export async function handleReviewTranslation(rawId: unknown, language: unknown, status: unknown, ctx: AdminContext): Promise<AdminResult> {
  const auth = await authorize(ctx);
  if ("error" in auth) return fail(auth.error);
  const id = parseOpportunityId(rawId);
  if (!id || typeof language !== "string" || !/^[a-z]{2}$/.test(language) || (status !== "human" && status !== "machine_draft" && status !== "machine_approved")) return fail("invalid");
  try {
    const record = await auth.admin.get(id);
    const translation = record?.translations.find((t) => t.language === language && t.status !== "original");
    if (!record || !translation) return fail("not_found");
    await auth.admin.reviewTranslation(id, language, status);
    return { ok: true };
  } catch (error) {
    return fail(codeOf(error));
  }
}

export async function handleDeleteOpportunity(rawId: unknown, ctx: AdminContext): Promise<AdminResult> {
  const auth = await authorize(ctx);
  if ("error" in auth) return fail(auth.error);
  const id = parseOpportunityId(rawId);
  if (!id) return fail("invalid");
  try {
    const record = await auth.admin.get(id);
    if (!record) return fail("not_found");
    if (record.publicationStatus === "published") return fail("archive_first");
    await auth.admin.remove(id);
    return { ok: true };
  } catch (error) {
    return fail(codeOf(error));
  }
}

export async function handleSaveOrganization(form: FormData, ctx: AdminContext): Promise<AdminResult<{ id: string }>> {
  const auth = await authorize(ctx);
  if ("error" in auth) return fail(auth.error);
  try {
    // Renaming must not silently change the slug (it is part of URLs): a blank slug on edit keeps the stored one.
    const rawId = typeof form.get("id") === "string" ? (form.get("id") as string).trim() : "";
    const blankSlug = typeof form.get("slug") !== "string" || (form.get("slug") as string).trim() === "";
    if (rawId && blankSlug) {
      const existing = await auth.admin.getOrganization(rawId);
      if (existing) form.set("slug", existing.slug);
    }
    const parsed = parseOrganizationForm(form);
    if (!parsed.ok) return fail("invalid", { fieldErrors: parsed.errors });
    return { ok: true, id: await auth.admin.saveOrganization(parsed.value) };
  } catch (error) {
    return fail(codeOf(error));
  }
}

export async function handleDeleteOrganization(rawId: unknown, ctx: AdminContext): Promise<AdminResult> {
  const auth = await authorize(ctx);
  if ("error" in auth) return fail(auth.error);
  const id = parseOpportunityId(rawId);
  if (!id) return fail("invalid");
  try {
    const org = await auth.admin.getOrganization(id);
    if (!org) return fail("not_found");
    if (org.opportunityCount > 0) return fail("in_use");
    await auth.admin.removeOrganization(id);
    return { ok: true };
  } catch (error) {
    return fail(codeOf(error));
  }
}
