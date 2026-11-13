import { getSupabasePublicConfig } from "@/lib/env";

export type AuthMode = "supabase" | "fake" | "unconfigured";

type Env = Record<string, string | undefined>;

/**
 * The in-memory fake auth backend exists ONLY for local development and automated browser
 * tests, where Supabase Auth is not available. It can never run in production: NODE_ENV
 * "production" disables it regardless of any variable (and the fake module refuses to load).
 */
export const isFakeAuthEnabled = (env: Env = process.env) => env.NODE_ENV !== "production" && env.FAKE_AUTH === "1";

/**
 *  - Supabase configured          → real Supabase Auth
 *  - not configured + FAKE_AUTH=1 → fake (development only)
 *  - otherwise                    → unconfigured: the forms explain that authentication is unavailable
 */
export function getAuthMode(env: Env = process.env): AuthMode {
  if (getSupabasePublicConfig(env)) return "supabase";
  return isFakeAuthEnabled(env) ? "fake" : "unconfigured";
}
