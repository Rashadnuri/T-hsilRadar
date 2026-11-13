import { routing, type Locale } from "@/i18n/routing";

export const SITE_NAME = "TəhsilRadar";

type Env = Record<string, string | undefined>;

const stripSlashes = (value: string) => value.trim().replace(/\/+$/, "");
const isLocalHost = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);

/**
 * Canonical origin without a trailing slash. Order:
 *  1. NEXT_PUBLIC_SITE_URL — set it for the **Production** environment only, to the public domain;
 *  2. on Vercel: the production domain (production deployments) or the deployment's own URL
 *     (preview deployments), so a preview never advertises, or sends e-mail links to, production;
 *  3. http://localhost:3000.
 */
export function getSiteUrl(env: Env = process.env): string {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return stripSlashes(explicit);
  const host = env.VERCEL_ENV === "production" ? (env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL) : env.VERCEL_URL;
  return host ? `https://${stripSlashes(host).replace(/^https?:\/\//, "")}` : "http://localhost:3000";
}

/**
 * Whether search engines may index this deployment. Vercel previews and local runs never are:
 * robots.txt disallows everything and an `X-Robots-Tag: noindex` header is sent.
 */
export function isIndexableDeployment(env: Env = process.env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production" && !isLocalHost(getSiteUrl(env));
}

/** Builds a locale-prefixed path, e.g. localePath("en", "/about") → "/en/about". */
export function localePath(locale: Locale, path = ""): string {
  const clean = path === "/" ? "" : path;
  return `/${locale}${clean}`;
}

export function absoluteUrl(locale: Locale, path = ""): string {
  return `${getSiteUrl()}${localePath(locale, path)}`;
}

/**
 * hreflang map. `locales` lists the languages in which the page really exists (default: all).
 * x-default is the site's default language when available, else `preferred` (a record's original
 * language), else the first available one — so hreflang never points at a page that is not indexable.
 */
export function languageAlternates(path = "", locales: readonly Locale[] = routing.locales, preferred?: Locale): Record<string, string> {
  if (locales.length === 0) return {};
  const entries = locales.map((l) => [l, absoluteUrl(l, path)] as const);
  const fallback = locales.includes(routing.defaultLocale) ? routing.defaultLocale : preferred && locales.includes(preferred) ? preferred : locales[0]!;
  return { ...Object.fromEntries(entries), "x-default": absoluteUrl(fallback, path) };
}
