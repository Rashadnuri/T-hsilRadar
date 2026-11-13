/**
 * Authentication contracts. The app depends on THESE, never on supabase-js directly, so the
 * flows (validation → gateway → redirect) are testable without an auth server and the one
 * place that talks to Supabase Auth stays small.
 */

/** Everything the UI can be told about a failed auth operation. Always a code, never prose. */
export type AuthErrorCode =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "weak_password"
  | "same_password"
  | "rate_limited"
  | "registration_failed"
  | "invalid_link"
  | "session_missing"
  | "not_configured"
  | "unavailable";

export type AuthResult<T = void> = { ok: true; data: T } | { ok: false; code: AuthErrorCode };

export interface AuthUser {
  id: string;
  email: string;
  /** From sign-up metadata; the profile (not this) is the source of truth afterwards. */
  fullName: string | null;
  emailConfirmed: boolean;
}

export interface CookieOptionsLike {
  path?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none" | boolean;
  domain?: string;
}
export interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptionsLike;
}

/** Where session cookies are read and written: Next's cookie store, or a request/response pair in the proxy. */
export interface CookieJar {
  getAll(): { name: string; value: string }[];
  /** `headers` are cache-control headers that must accompany auth cookies (CDN safety). */
  setAll(cookies: CookieToSet[], headers?: Record<string, string>): void;
}

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  /** Interface language: stored with the user (email templates) and kept in the confirmation link. */
  locale: string;
  /** Absolute URL the confirmation email links to. */
  redirectTo: string;
}

export interface AuthGateway {
  signUp(input: SignUpInput): Promise<AuthResult<{ needsEmailConfirmation: boolean }>>;
  signIn(email: string, password: string): Promise<AuthResult<AuthUser>>;
  signOut(): Promise<AuthResult>;
  /** Always succeeds from the caller's view when the address is well-formed (no account enumeration). */
  requestPasswordReset(email: string, redirectTo: string): Promise<AuthResult>;
  /** Completes an emailed link (confirmation or recovery): exchanges its one-time code for a session. */
  exchangeCode(code: string): Promise<AuthResult<AuthUser>>;
  /** Requires a session (the recovery session, or a logged-in user). */
  updatePassword(password: string): Promise<AuthResult>;
  /** The user of the current session, VERIFIED with the auth server (never just decoded from the cookie). */
  getUser(): Promise<AuthUser | null>;
  /** Optimistic and cheap: is there a session? Refreshes tokens when they are about to expire. */
  hasSession(): Promise<boolean>;
}
