import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServiceRoleKey, getSupabasePublicConfig } from "@/lib/env";
import type { SupabaseLike } from "./types";

/**
 * SERVICE-ROLE client: bypasses row level security. Trusted server code ONLY (admin actions,
 * imports, cron — none exist yet, so nothing imports this module).
 *
 * Rules (SECURITY.md §8):
 *  - the key is never prefixed NEXT_PUBLIC_ and never reaches the browser;
 *  - this file is marked `server-only`, so importing it from a client component fails the build;
 *  - a test fails if any file other than an allow-listed one imports it.
 */
export function createSupabaseAdminClient(): SupabaseLike {
  const config = getSupabasePublicConfig();
  const serviceKey = getServiceRoleKey();
  if (!config || !serviceKey) {
    throw new Error("The service-role client needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  const client = createClient(config.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client as unknown as SupabaseLike;
}
