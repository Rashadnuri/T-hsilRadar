import { randomBytes } from "node:crypto";
import { CSV_LIMITS } from "@/lib/import/csv";
import { validateImport, type ImportContext, type ImportIssue, type ImportPreview, type ImportRow } from "@/lib/import/validate";
import { parseSourceForm } from "@/validation/admin";
import { parseOpportunityId } from "@/validation/plan";
import type { FieldErrors } from "@/validation/messages";
import type { AdminRepository } from "@/repositories/admin/types";
import { authorize, type AdminContext, type AdminErrorCode } from "./handlers";
import { AdminRepositoryError } from "@/repositories/admin/types";

/**
 * Sources, CSV import and data-quality operations (pure, tested). Same rule as every admin
 * handler: the first thing awaited is `authorize(ctx)`.
 *
 * The import has two steps and TWO server runs of the same validation: "preview" shows every row
 * and every problem without saving anything; "commit" re-validates the file (the preview is never
 * trusted), saves only importable rows, ALWAYS as unverified drafts, and reports each row.
 */

const fail = (code: AdminErrorCode, extra: { fieldErrors?: FieldErrors } = {}) => ({ ok: false as const, code, ...extra });

function codeOf(error: unknown): AdminErrorCode {
  if (!(error instanceof AdminRepositoryError)) return "failed";
  switch (error.reason) {
    case "forbidden": return "forbidden";
    case "not_found": return "not_found";
    case "conflict": return "conflict";
    case "in_use": return "in_use";
    case "invalid": return "invalid";
    default: return "failed";
  }
}

// ── sources ────────────────────────────────────────────────────────────────────────────────

export async function handleSaveSource(form: FormData, ctx: AdminContext) {
  const auth = await authorize(ctx);
  if ("error" in auth) return fail(auth.error);
  const parsed = parseSourceForm(form);
  if (!parsed.ok) return fail("invalid", { fieldErrors: parsed.errors });
  try {
    return { ok: true as const, id: await auth.admin.saveSource(parsed.value) };
  } catch (error) {
    return fail(codeOf(error));
  }
}

export async function handleMarkSourceChecked(rawId: unknown, ctx: AdminContext) {
  const auth = await authorize(ctx);
  if ("error" in auth) return fail(auth.error);
  const id = parseOpportunityId(rawId);
  if (!id) return fail("invalid");
  try {
    await auth.admin.markSourceChecked(id);
    return { ok: true as const };
  } catch (error) {
    return fail(codeOf(error));
  }
}

export async function handleDeleteSource(rawId: unknown, ctx: AdminContext) {
  const auth = await authorize(ctx);
  if ("error" in auth) return fail(auth.error);
  const id = parseOpportunityId(rawId);
  if (!id) return fail("invalid");
  try {
    await auth.admin.removeSource(id);
    return { ok: true as const };
  } catch (error) {
    return fail(codeOf(error));
  }
}

// ── import ─────────────────────────────────────────────────────────────────────────────────

async function importContext(admin: AdminRepository, now?: Date): Promise<ImportContext> {
  const [organizations, sources, index] = await Promise.all([admin.listOrganizations(), admin.listSources(), admin.duplicateIndex()]);
  return {
    organizations: organizations.map((o) => ({ id: o.id, slug: o.slug, name: o.name })),
    sources: sources.map((s) => ({ id: s.id, websiteUrl: s.websiteUrl, organizationName: s.organizationName, isActive: s.isActive })),
    index,
    now,
  };
}

/** What the browser needs to draw the preview (no full texts: the commit re-reads the file). */
export interface ImportPreviewView extends Omit<ImportPreview, "rows"> {
  rows: (Omit<ImportRow, "input"> & { languages: string[]; importable: boolean })[];
}

const toView = (preview: ImportPreview): ImportPreviewView => ({
  ...preview,
  rows: preview.rows.map(({ input, ...row }) => ({ ...row, languages: input ? input.translations.map((t) => t.language) : [], importable: row.status === "ok" || row.status === "warning" })),
});

const tooLarge = (csv: unknown): csv is string => typeof csv === "string" && new TextEncoder().encode(csv).length > CSV_LIMITS.maxBytes;

export async function handleImportPreview(csv: unknown, ctx: AdminContext): Promise<{ ok: true; preview: ImportPreviewView } | { ok: false; code: AdminErrorCode }> {
  const auth = await authorize(ctx);
  if ("error" in auth) return fail(auth.error);
  if (typeof csv !== "string") return fail("invalid");
  try {
    // Oversized files are reported as a file problem by the validator (nothing is parsed).
    const preview = validateImport(tooLarge(csv) ? "" : csv, await importContext(auth.admin, ctx.now));
    if (tooLarge(csv)) preview.fileProblems = ["too_large"];
    return { ok: true, preview: toView(preview) };
  } catch (error) {
    return fail(codeOf(error));
  }
}

export interface ImportRowResult {
  line: number;
  title: string;
  outcome: "created" | "failed" | "skipped";
  id?: string;
  code?: AdminErrorCode;
  reason?: "duplicate" | "possible_duplicate" | "error";
}

export interface ImportCommitResult {
  ok: true;
  batch: string;
  created: number;
  failed: number;
  skipped: number;
  results: ImportRowResult[];
}

export const newBatchId = (now = new Date()) => `${now.toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;

export async function handleImportCommit(csv: unknown, options: { includePossibleDuplicates?: boolean }, ctx: AdminContext): Promise<ImportCommitResult | { ok: false; code: AdminErrorCode }> {
  const auth = await authorize(ctx);
  if ("error" in auth) return fail(auth.error);
  if (typeof csv !== "string" || tooLarge(csv)) return fail("invalid");
  try {
    const preview = validateImport(csv, await importContext(auth.admin, ctx.now));
    if (preview.fileProblems.length > 0 || preview.missingColumns.length > 0 || preview.duplicateColumns.length > 0) return fail("invalid");
    const batch = newBatchId(ctx.now);
    const results: ImportRowResult[] = [];
    for (const row of preview.rows) {
      const importable = row.input !== null && (row.status === "ok" || row.status === "warning" || (row.status === "possible_duplicate" && options.includePossibleDuplicates === true));
      if (!importable || !row.input) {
        results.push({ line: row.line, title: row.title, outcome: "skipped", reason: row.status === "duplicate" ? "duplicate" : row.status === "possible_duplicate" ? "possible_duplicate" : "error" });
        continue;
      }
      try {
        // Always a NEW record as an unverified DRAFT: the save function has no way to publish or verify.
        const id = await auth.admin.save({ ...row.input, id: undefined, sourceId: row.sourceId, importBatch: batch });
        results.push({ line: row.line, title: row.title, outcome: "created", id });
      } catch (error) {
        results.push({ line: row.line, title: row.title, outcome: "failed", code: codeOf(error) });
      }
    }
    const count = (o: ImportRowResult["outcome"]) => results.filter((r) => r.outcome === o).length;
    return { ok: true, batch, created: count("created"), failed: count("failed"), skipped: count("skipped"), results };
  } catch (error) {
    return fail(codeOf(error));
  }
}

// ── data quality ───────────────────────────────────────────────────────────────────────────

export async function handleExpireCheck(ctx: AdminContext): Promise<{ ok: true; flagged: number } | { ok: false; code: AdminErrorCode }> {
  const auth = await authorize(ctx);
  if ("error" in auth) return fail(auth.error);
  try {
    return { ok: true, flagged: await auth.admin.expireOpportunities(ctx.now) };
  } catch (error) {
    return fail(codeOf(error));
  }
}

export type { ImportIssue };
