import type { MetadataRoute } from "next";
import { buildSitemap } from "@/lib/seo/sitemap";
import { listOpportunitiesForMatching } from "@/services/opportunities";

// Rebuilt at most once an hour; a database outage must degrade to the static pages, not break the file.
export const revalidate = 3600;

const MAX_OPPORTUNITIES = 1000; // × 3 languages = 3000 URLs, far below the 50 000 limit of one sitemap file

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    return buildSitemap(await listOpportunitiesForMatching(MAX_OPPORTUNITIES));
  } catch (error) {
    console.error("sitemap: could not read opportunities, listing static pages only", error instanceof Error ? error.message : "");
    return buildSitemap([]);
  }
}
