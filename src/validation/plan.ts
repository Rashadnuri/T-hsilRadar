import { z } from "zod";
import { APPLICATION_STATUSES, PLAN_LIMITS, type ApplicationStatus } from "@/types/plan";
import { toFieldErrors, type FieldErrors } from "./messages";

/**
 * Opportunity ids are database uuids (or "demo-…" slugs in the demo data). The pattern only has
 * to keep junk out of queries: the id must also match a PUBLIC opportunity before anything is stored.
 */
export const opportunityIdSchema = z
  .string({ error: "required" })
  .trim()
  .min(1, "required")
  .max(64, "invalid_choice")
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "invalid_choice");

export const parseOpportunityId = (value: unknown): string | null => {
  const parsed = opportunityIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const status = z.enum(APPLICATION_STATUSES, { error: "invalid_choice" });

/** Notes are plain text: trimmed, blank → null, size-capped. (They are rendered escaped, never as HTML.) */
const notes = z
  .string()
  .max(PLAN_LIMITS.notesMax * 2, "text_too_long")
  .transform((v) => v.replace(/\r\n/g, "\n").trim())
  .pipe(z.string().max(PLAN_LIMITS.notesMax, "text_too_long"))
  .transform((v) => (v === "" ? null : v));

const updateSchema = z.object({ opportunityId: opportunityIdSchema, status, notes });

export interface ApplicationUpdate {
  opportunityId: string;
  status: ApplicationStatus;
  notes: string | null;
}

export type ParsedUpdate = { ok: true; value: ApplicationUpdate } | { ok: false; errors: FieldErrors };

const text = (form: FormData, name: string) => (typeof form.get(name) === "string" ? (form.get(name) as string) : "");

export function parseApplicationUpdate(form: FormData): ParsedUpdate {
  const result = updateSchema.safeParse({ opportunityId: text(form, "opportunityId"), status: text(form, "status"), notes: text(form, "notes") });
  if (!result.success) return { ok: false, errors: toFieldErrors(result.error, { text_too_long: { max: PLAN_LIMITS.notesMax } }) };
  return { ok: true, value: result.data };
}
