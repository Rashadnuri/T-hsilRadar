import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { SupabasePublicConfig } from "@/lib/env";
import { hardenCookies, sessionCookieOptions } from "./cookies";
import { mapSupabaseAuthError } from "./errors";
import type { AuthGateway, AuthResult, AuthUser, CookieJar, SignUpInput } from "./types";

/**
 * A Supabase client bound to the visitor's session cookies. Used by the auth gateway AND the
 * profile repository, so database queries run with the user's own JWT (row level security
 * then restricts them to their own profile). Create ONE per request; never share across requests.
 */
export function createSupabaseUserClient(config: SupabasePublicConfig, jar: CookieJar): SupabaseClient {
  return createServerClient(config.url, config.anonKey, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (cookies, headers) => {
        try {
          jar.setAll(hardenCookies(cookies), headers);
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes
          // the session on every request, so nothing is lost.
        }
      },
    },
  });
}

const toAuthUser = (user: User): AuthUser => ({
  id: user.id,
  email: user.email ?? "",
  fullName: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null,
  emailConfirmed: Boolean(user.email_confirmed_at),
});

const fail = (error: Parameters<typeof mapSupabaseAuthError>[0]): AuthResult<never> => ({ ok: false, code: mapSupabaseAuthError(error) });
const done: AuthResult = { ok: true, data: undefined };

export class SupabaseAuthGateway implements AuthGateway {
  constructor(private readonly client: SupabaseClient) {}

  async signUp({ email, password, fullName, locale, redirectTo }: SignUpInput) {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo, data: { full_name: fullName, locale } },
    });
    if (error) return fail(error);
    // No session ⇒ Supabase requires e-mail confirmation first. (For an e-mail that already exists
    // Supabase also answers "confirmation needed" without an error, so this reveals nothing.)
    return { ok: true, data: { needsEmailConfirmation: !data.session } } as const;
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error || !data.user) return fail(error ?? { code: "invalid_credentials" });
    return { ok: true, data: toAuthUser(data.user) } as const;
  }

  async signOut() {
    // "local": ends THIS device's session only (other devices stay signed in).
    const { error } = await this.client.auth.signOut({ scope: "local" });
    return error ? fail(error) : done;
  }

  async requestPasswordReset(email: string, redirectTo: string) {
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
    // Only operational failures are reported; "no such user" is indistinguishable from success.
    if (error) {
      const code = mapSupabaseAuthError(error);
      if (code === "rate_limited" || code === "unavailable") return { ok: false, code } as const;
    }
    return done;
  }

  async exchangeCode(code: string) {
    const { data, error } = await this.client.auth.exchangeCodeForSession(code);
    if (error || !data.user) return { ok: false, code: error ? mapSupabaseAuthError(error) : "invalid_link" } as const;
    return { ok: true, data: toAuthUser(data.user) } as const;
  }

  async updatePassword(password: string) {
    const { error } = await this.client.auth.updateUser({ password });
    return error ? fail(error) : done;
  }

  async getUser() {
    // getUser() asks the auth server to validate the token. getSession() only decodes the cookie
    // and MUST NOT be used for authorization decisions.
    const { data, error } = await this.client.auth.getUser();
    return error || !data.user ? null : toAuthUser(data.user);
  }

  async hasSession() {
    // Cheap check for the proxy: reads the cookie and refreshes tokens that are about to expire.
    // Not trusted for authorization (pages call getUser()).
    const { data } = await this.client.auth.getSession();
    return data.session !== null;
  }
}
