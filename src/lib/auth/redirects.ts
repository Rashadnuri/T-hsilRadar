import { locales } from "@/i18n/routing";

const FALLBACK = "/profile";
const BASE = "http://relative.invalid";

/** Paths a `next` parameter may never point to (login loops, internals). */
const FORBIDDEN_PREFIXES = ["/login", "/register", "/forgot-password", "/auth", "/api", "/_next"];

/**
 * Sanitises the post-login destination. Only a same-site, locale-less path survives:
 *  - absolute URLs, protocol-relative (`//evil.com`), backslash tricks, control characters,
 *    and anything that resolves to another origin are replaced by the fallback;
 *  - a locale prefix is stripped (the redirect re-applies the CURRENT locale);
 *  - auth pages themselves are refused so a bad link can never create a redirect loop.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = FALLBACK): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (value.length === 0 || value.length > 300) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;

  // Encoded slashes/backslashes have no legitimate use here and are a classic way to smuggle `//host`.
  if (/%2f|%5c/i.test(url.pathname)) return fallback;

  const path = url.pathname.replace(new RegExp(`^/(?:${locales.join("|")})(?=/|$)`), "") || "/";
  // URL normalisation can collapse "/..//evil.example" into "//evil.example": never return that.
  if (path.startsWith("//")) return fallback;
  if (FORBIDDEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return fallback;
  return `${path}${url.search}`;
}
