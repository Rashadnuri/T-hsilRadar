import type { MetadataRoute } from "next";
import { getSiteUrl, isIndexableDeployment } from "@/lib/site";

/** Session-only areas: pointless for crawlers (they redirect to the login page or are per-user). */
export const PRIVATE_PATHS = ["/api/", "/*/admin", "/*/profile", "/*/my-plan", "/*/matches", "/*/auth/"];

export default function robots(): MetadataRoute.Robots {
  // Previews and local runs: keep everything out of search engines.
  if (!isIndexableDeployment()) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS }, sitemap: `${getSiteUrl()}/sitemap.xml` };
}
