import { getSupabasePublicConfig } from "@/lib/env";
import type { SupabaseLike } from "@/lib/supabase/types";
import { SupabaseAdminRepository, SupabaseRoleRepository } from "@/repositories/admin/supabase-admin-repository";
import type { AdminRepository, RoleRepository } from "@/repositories/admin/types";
import { SupabasePlanRepository } from "@/repositories/plan/supabase-plan-repository";
import type { PlanRepository } from "@/repositories/plan/types";
import { SupabaseProfileRepository } from "@/repositories/profile/supabase-profile-repository";
import type { ProfileRepository } from "@/repositories/profile/types";
import { getAuthMode, type AuthMode } from "./mode";
import { createSupabaseUserClient, SupabaseAuthGateway } from "./supabase-gateway";
import type { AuthGateway, CookieJar } from "./types";
import { unconfiguredGateway } from "./unconfigured-gateway";

export interface AuthContext {
  mode: AuthMode;
  auth: AuthGateway;
  /** null when authentication is not configured. */
  profiles: ProfileRepository | null;
  /** The visitor's private plan (saved opportunities, applications). null when authentication is not configured. */
  plan: PlanRepository | null;
  /** Who is an admin (null when authentication is not configured). */
  roles: RoleRepository | null;
  /** Admin data access under the visitor's own session. ALWAYS check the role first (see lib/auth/admin.ts). */
  admin: AdminRepository | null;
}

/**
 * Builds the auth gateway and profile repository for ONE request, bound to that request's
 * cookies. Supabase queries made through this context run under the visitor's own session.
 */
export async function createAuthContext(jar: CookieJar): Promise<AuthContext> {
  const mode = getAuthMode();
  if (mode === "supabase") {
    const config = getSupabasePublicConfig()!;
    const client = createSupabaseUserClient(config, jar);
    const db = client as unknown as SupabaseLike;
    return { mode, auth: new SupabaseAuthGateway(client), profiles: new SupabaseProfileRepository(db), plan: new SupabasePlanRepository(db), roles: new SupabaseRoleRepository(db), admin: new SupabaseAdminRepository(db) };
  }
  if (mode === "fake") {
    // Loaded lazily and only when explicitly enabled outside production (see mode.ts).
    const { createFakeAuth } = await import("./fake/gateway");
    return { mode, ...createFakeAuth(jar) };
  }
  return { mode, auth: unconfiguredGateway, profiles: null, plan: null, roles: null, admin: null };
}
