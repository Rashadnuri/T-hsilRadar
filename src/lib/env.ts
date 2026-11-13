/**
 * Environment access in one place. Nothing else reads process.env for Supabase.
 *
 * Variables (see .env.example):
 *  - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — public by design; safe ONLY
 *    because row level security restricts what the anon role can read.
 *  - SUPABASE_SERVICE_ROLE_KEY — bypasses RLS. Server-only, never NEXT_PUBLIC_, read only in
 *    lib/supabase/admin.ts.
 */

export interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}

type Env = Record<string, string | undefined>;

/** Values copied unchanged from .env.example count as "not configured", not as credentials. */
const isPlaceholder = (value: string) => /^your-|your-project-ref|^changeme$|^<.*>$/i.test(value);

const clean = (value: string | undefined): string | null => {
  const v = value?.trim();
  return v && !isPlaceholder(v) ? v : null;
};

/**
 * Supabase public settings, or null when Supabase is not configured (the app then serves the
 * clearly-labelled demo content). Throws if it is configured only halfway or with a bad URL:
 * a half-configured production site must fail loudly, not silently show demo data.
 */
export function getSupabasePublicConfig(env: Env = process.env): SupabasePublicConfig | null {
  const url = clean(env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = clean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!url && !anonKey) return null;
  if (!url || !anonKey) {
    throw new Error("Supabase is half-configured: set BOTH NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or neither).");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use https (http is only allowed for localhost).");
  }
  return { url: url.replace(/\/+$/, ""), anonKey };
}

export const isSupabaseConfigured = (env: Env = process.env) => getSupabasePublicConfig(env) !== null;

/**
 * Whether the labelled demo records are shown.
 *  - SHOW_DEMO_CONTENT=true / false decides explicitly (set it per Vercel environment);
 *  - unset: shown while developing and testing, HIDDEN in a production build, so a deployment that
 *    forgets the variable can never present fictional records as real ones.
 */
export const isDemoContentEnabled = (env: Env = process.env) => {
  const value = env.SHOW_DEMO_CONTENT?.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return env.NODE_ENV !== "production";
};

/** Service-role key for trusted server code only. Returns null when unset or a placeholder. */
export const getServiceRoleKey = (env: Env = process.env) => clean(env.SUPABASE_SERVICE_ROLE_KEY);
