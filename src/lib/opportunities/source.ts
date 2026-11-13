/**
 * Safety checks for official/application links (SECURITY.md §6). These guard what we STORE and
 * LINK TO; server-side fetching of these URLs (link checker, import) needs the same host rules.
 */

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
];

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(hostname));
}

/** https only, no credentials in the URL, no private/internal hosts, a real hostname with a dot. */
export function isSafeHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.hostname.includes(".") &&
    !isPrivateHost(url.hostname)
  );
}

const stripWww = (host: string) => host.toLowerCase().replace(/^www\./, "");

/**
 * Does `url` belong to the organization's own site (same host or a subdomain)? A moderator
 * check, not a security boundary: it flags sources that are NOT on the organization's domain
 * (aggregators, social pages) so the verification checklist can look closer.
 */
export function isOnOrganizationDomain(url: string, organizationWebsite: string | null): boolean {
  if (!organizationWebsite) return false;
  try {
    const host = stripWww(new URL(url).hostname);
    const orgHost = stripWww(new URL(organizationWebsite).hostname);
    return host === orgHost || host.endsWith(`.${orgHost}`);
  } catch {
    return false;
  }
}
