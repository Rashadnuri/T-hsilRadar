import type { AuthErrorCode } from "./types";

/** The shape of supabase-js's AuthError that we rely on. */
export interface SupabaseAuthErrorLike {
  code?: string | null;
  status?: number | null;
  name?: string;
  message?: string;
}

/**
 * Maps Supabase Auth errors to our codes. Deliberately COARSE and neutral:
 *  - an existing e-mail at sign-up is reported as the generic `registration_failed`
 *    (never "this email is registered": account enumeration);
 *  - unknown errors become `unavailable` rather than leaking provider messages.
 */
export function mapSupabaseAuthError(error: SupabaseAuthErrorLike): AuthErrorCode {
  const code = error.code ?? "";
  switch (code) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "email_not_confirmed":
      return "email_not_confirmed";
    case "user_already_exists":
    case "email_exists":
    case "identity_already_exists":
    case "signup_disabled":
      return "registration_failed";
    case "weak_password":
      return "weak_password";
    case "same_password":
      return "same_password";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
    case "over_sms_send_rate_limit":
      return "rate_limited";
    case "flow_state_not_found":
    case "flow_state_expired":
    case "bad_code_verifier":
    case "otp_expired":
    case "otp_disabled":
    case "bad_jwt":
      return "invalid_link";
    case "session_not_found":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
      return "session_missing";
  }
  if (error.name === "AuthSessionMissingError") return "session_missing";
  if (error.status === 429) return "rate_limited";
  if (error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status ?? 0) >= 500) return "unavailable";
  if (error.status === 422 && /password/i.test(error.message ?? "")) return "weak_password";
  if (error.status === 400 || error.status === 401 || error.status === 403) return "invalid_credentials";
  return "unavailable";
}
