import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoContentEnabled } from "@/lib/env";
import { DemoOpportunityRepository, DemoOrganizationRepository } from "./demo/demo-repository";
import { SupabaseOpportunityRepository, SupabaseOrganizationRepository } from "./supabase/supabase-repository";
import type { OpportunityRepository, OrganizationRepository } from "./types";

/**
 * Picks the data source from the environment:
 *  - Supabase configured → Supabase (anon role, RLS enforced);
 *  - otherwise           → the labelled demo records (local UI work, previews, CI).
 * Server-only (it imports the server Supabase client).
 */
export function getOpportunityRepository(): OpportunityRepository {
  const db = createSupabaseServerClient();
  const includeDemo = isDemoContentEnabled();
  return db ? new SupabaseOpportunityRepository(db, { includeDemo }) : new DemoOpportunityRepository({ enabled: includeDemo });
}

export function getOrganizationRepository(): OrganizationRepository {
  const db = createSupabaseServerClient();
  const includeDemo = isDemoContentEnabled();
  return db ? new SupabaseOrganizationRepository(db, { includeDemo }) : new DemoOrganizationRepository({ enabled: includeDemo });
}

export type { OpportunityRepository, OrganizationRepository } from "./types";
