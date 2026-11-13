import { z } from "zod";
import { PROFILE_LIMITS } from "@/types/profile";
import { hasRawHtml, toFieldErrors, type FieldErrors } from "./messages";

/** Password rules (SECURITY.md §3): ≥ 10 characters; ≤ 72 BYTES (bcrypt ignores anything beyond). */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX_BYTES = 72;

const email = z
  .string({ error: "required" })
  .trim()
  .toLowerCase()
  .min(1, "required")
  .max(254, "invalid_email")
  .pipe(z.email({ error: "invalid_email" }));

const newPassword = z
  .string({ error: "required" })
  .min(1, "required")
  .min(PASSWORD_MIN, "password_too_short")
  .refine((v) => new TextEncoder().encode(v).length <= PASSWORD_MAX_BYTES, "password_too_long");

const fullName = z
  .string({ error: "required" })
  .trim()
  .min(1, "required")
  .min(PROFILE_LIMITS.fullNameMin, "name_too_short")
  .max(PROFILE_LIMITS.fullNameMax, "text_too_long")
  .refine((v) => !hasRawHtml(v), "html_not_allowed");

// Login does not re-check the password policy (an old password must still work), only presence.
export const loginSchema = z.object({ email, password: z.string({ error: "required" }).min(1, "required") });

export const registerSchema = z
  .object({ fullName, email, password: newPassword, confirmPassword: z.string({ error: "required" }).min(1, "required") })
  .superRefine((value, ctx) => {
    if (value.password.toLowerCase() === value.email) ctx.addIssue({ code: "custom", path: ["password"], message: "password_same_as_email" });
    if (value.password !== value.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "passwords_do_not_match" });
  });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string({ error: "required" }).min(1, "required") })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "passwords_do_not_match" });
  });

export const AUTH_ERROR_PARAMS = {
  password_too_short: { min: PASSWORD_MIN },
  password_too_long: { max: PASSWORD_MAX_BYTES },
  name_too_short: { min: PROFILE_LIMITS.fullNameMin },
  text_too_long: { max: PROFILE_LIMITS.fullNameMax },
} as const;

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

function run<S extends z.ZodType>(schema: S, input: unknown): Parsed<z.output<S>> {
  const result = schema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false, errors: toFieldErrors(result.error, AUTH_ERROR_PARAMS) };
}

/** Reads named string fields from FormData (missing → undefined so "required" fires). */
export const fields = (form: FormData, names: readonly string[]): Record<string, string | undefined> =>
  Object.fromEntries(names.map((n) => [n, typeof form.get(n) === "string" ? (form.get(n) as string) : undefined]));

export const parseLogin = (form: FormData) => run(loginSchema, fields(form, ["email", "password"]));
export const parseRegister = (form: FormData) => run(registerSchema, fields(form, ["fullName", "email", "password", "confirmPassword"]));
export const parseForgotPassword = (form: FormData) => run(forgotPasswordSchema, fields(form, ["email"]));
export const parseResetPassword = (form: FormData) => run(resetPasswordSchema, fields(form, ["password", "confirmPassword"]));
