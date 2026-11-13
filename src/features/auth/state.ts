import type { AuthErrorCode } from "@/lib/auth/types";
import type { FieldErrors } from "@/validation/messages";

export type FormMessage = "check_email" | "reset_sent" | "saved";
export type FormError = AuthErrorCode | "form_invalid" | "unauthorized" | "save_failed";

/**
 * What a server action tells the form. Only codes and echoed, non-secret values: the UI maps
 * codes to the visitor's language (validation.* / authErrors.* / auth.* / profile.* messages).
 * Passwords are NEVER echoed back.
 */
export interface FormState {
  status: "idle" | "error" | "success";
  fieldErrors?: FieldErrors;
  formError?: FormError;
  message?: FormMessage;
  values?: Record<string, string>;
}

export const initialFormState: FormState = { status: "idle" };
