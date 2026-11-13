import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/env";
import type { SupabaseLike } from "./types";

/**
 * Server-side Supabase client using the ANON key. Reads only what row level security lets the
 * `anon` role read (published, verified-or-demo opportunities). There is no browser client: no
 * feature needs one yet (no auth, no realtime), and every page reads on the server.
 *
 * No session persistence: until the authentication phase there are no user sessions.
 * Returns null when Supabase is not configured (the app then uses the labelled demo data).
 */
export function createSupabaseServerClient(): SupabaseLike | null {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-application-name": "tahsilradar-web" } },
  });
  // The narrow SupabaseLike interface is satisfied structurally by the real client.
  return client as unknown as SupabaseLike;
}
