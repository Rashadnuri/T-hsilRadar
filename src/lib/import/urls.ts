/**
 * URL validation for official sources. Everything here is OFFLINE string analysis: the platform
 * never fetches a third-party site automatically (terms of use, robots.txt and rate limits belong
 * to the website's owner). A person opens the link and records that they checked it.
 */

export type UrlProblem =
  | "invalid" | "not_https" | "credentials" | "ip_address" | "local_address" | "placeholder_domain" | "too_long" // errors
  | "url_shortener" | "social_media" | "file_sharing" | "host_mismatch"; // warnings

export const URL_ERRORS: readonly UrlProblem[] = ["invalid", "not_https", "credentials", "ip_address", "local_address", "placeholder_domain", "too_long"];

const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "cutt.ly", "rb.gy", "shorturl.at", "tiny.cc", "buff.ly", "lnkd.in"]);
const SOCIAL = new Set(["facebook.com", "fb.com", "instagram.com", "twitter.com", "x.com", "t.me", "telegram.me", "linkedin.com", "tiktok.com", "youtube.com", "youtu.be", "vk.com", "ok.ru", "wa.me", "whatsapp.com"]);
const FILE_SHARING = new Set(["drive.google.com", "docs.google.com", "dropbox.com", "mega.nz", "wetransfer.com", "onedrive.live.com", "1drv.ms", "forms.gle"]);
/** Reserved for documentation: a URL here is a placeholder, never an official source (also catches the CSV template's example row). */
const PLACEHOLDER = /(^|\.)(example\.(com|org|net|edu)|test|invalid|localhost|example)$/i;

// Second-level public suffixes that matter for Azerbaijani and common international domains.
const TWO_LEVEL = new Set(["gov.az", "edu.az", "com.az", "org.az", "net.az", "info.az", "biz.az", "co.uk", "ac.uk", "gov.uk", "org.uk", "com.tr", "edu.tr", "gov.tr", "org.tr", "co.jp", "ac.jp", "com.au", "edu.au", "gov.au", "co.nz", "ac.nz", "com.cn", "edu.cn"]);

export function parseHost(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

/** "www.edu.gov.az" → "edu.gov.az"; "sub.example.co.uk" → "example.co.uk". Lower-case, without a trailing dot. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return TWO_LEVEL.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

const isIpv4 = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
const isIpv6 = (h: string) => h.startsWith("[") || h.includes(":");
const isLocalIpv6 = (h: string) => /^\[?(::1|::|fe80:|fc|fd)/i.test(h);
const isPrivateIpv4 = (h: string) => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);

/** Every problem with `raw` as an official-source URL. `knownHosts` are the websites of registered sources (to spot a mismatch). */
export function checkOfficialUrl(raw: string, knownHosts: readonly string[] = []): UrlProblem[] {
  const value = raw.trim();
  if (value.length > 2000) return ["too_long"];
  const url = parseHost(value);
  if (!url || /\s/.test(value)) return ["invalid"];
  const problems: UrlProblem[] = [];
  if (url.protocol !== "https:") problems.push("not_https");
  if (url.username || url.password) problems.push("credentials");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || (isIpv4(host) && isPrivateIpv4(host)) || (isIpv6(host) && isLocalIpv6(host))) problems.push("local_address");
  else if (isIpv4(host) || isIpv6(host)) problems.push("ip_address");
  else if (!host.includes(".")) problems.push("invalid");
  if (PLACEHOLDER.test(host)) problems.push("placeholder_domain");
  if (problems.length > 0) return problems;

  const domain = registrableDomain(host);
  if (SHORTENERS.has(domain)) problems.push("url_shortener");
  if (SOCIAL.has(domain)) problems.push("social_media");
  if (FILE_SHARING.has(domain) || FILE_SHARING.has(host)) problems.push("file_sharing");
  if (problems.length === 0 && knownHosts.length > 0 && !knownHosts.some((h) => registrableDomain(h) === domain)) problems.push("host_mismatch");
  return problems;
}

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|yclid|ref|ref_src)$/i;

/** A canonical form for comparing two links to the same page (case, www., trailing slash, fragments, tracking parameters, parameter order). */
export function normalizeUrl(raw: string): string | null {
  const url = parseHost(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
  const path = url.pathname.replace(/\/+$/, "") || "";
  return `${host}${path}${query}`;
}
