import { getOrganizationRepository } from "@/repositories";
import type { Organization } from "@/types/opportunity";

/** Organizations that have at least one public opportunity (public data only). */
export async function getOrganizationBySlug(slug: string): Promise<Organization | null> {
  return getOrganizationRepository().getBySlug(slug);
}

export async function getOrganizationById(id: string): Promise<Organization | null> {
  return getOrganizationRepository().getById(id);
}

export async function listPublicOrganizations(): Promise<Organization[]> {
  return getOrganizationRepository().listPublic();
}
