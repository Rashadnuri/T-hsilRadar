import type { ZodError } from "zod";

/**
 * Validation never produces prose. Every problem is a stable CODE (plus numeric parameters);
 * the UI turns it into the visitor's language (messages: validation.<code>). That keeps server
 * and client in sync, makes errors testable, and means no English string can leak into az/ru.
 */
export const VALIDATION_CODES = [
  "required", "invalid_email", "password_too_short", "password_too_long", "password_same_as_email", "passwords_do_not_match",
  "name_too_short", "text_too_long", "html_not_allowed", "invalid_choice", "invalid_year", "too_many_items", "item_too_long",
  "invalid_country", "invalid_language", "duplicate_items", "form_invalid",
  // administration
  "invalid_url", "invalid_slug", "invalid_amount", "invalid_currency", "invalid_date", "invalid_timezone", "deadline_required", "deadline_not_allowed",
  "other_label_required", "other_label_not_allowed", "city_conflict", "dates_out_of_order", "funding_pair", "funding_not_allowed", "percent_not_allowed",
] as const;
export type ValidationCode = (typeof VALIDATION_CODES)[number];

export interface FieldError {
  code: ValidationCode;
  params?: Record<string, number>;
}
export type FieldErrors = Record<string, FieldError>;

const isValidationCode = (value: string): value is ValidationCode => (VALIDATION_CODES as readonly string[]).includes(value);

/** Zod issues → first error per field. A message that is not a known code becomes `form_invalid`. */
export function toFieldErrors(error: ZodError, params: Partial<Record<ValidationCode, Record<string, number>>> = {}): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (field in out) continue;
    const code = isValidationCode(issue.message) ? issue.message : "form_invalid";
    out[field] = params[code] ? { code, params: params[code] } : { code };
  }
  return out;
}

const RAW_HTML = /<\/?[a-z][^>]*>|<!--/i;
export const hasRawHtml = (value: string) => RAW_HTML.test(value);
