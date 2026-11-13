/**
 * Production environment preflight. Pure function over an environment object: it reports what is
 * wrong or risky about a deployment's variables WITHOUT ever including a value in its output
 * (only variable names), so the report is safe to paste into a ticket or a CI log.
 * Run it with `npm run preflight` (see DEPLOYMENT.md).
 */
import { getContactEmail } from "./contact";

type Env = Record<string, string | undefined>;

export type Severity = "error" | "warning" | "info";
export interface PreflightFinding {
  severity: Severity;
  /** Variable (or topic) the finding is about. */
  subject: string;
  message: string;
}

const PLACEHOLDER = /^your-|your-project-ref|^changeme$|^<.*>$|example\.(com|org)$/i;
const isSet = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "" && !PLACEHOLDER.test(v.trim());

/** Role claim of a JWT-shaped key (no signature check — only to catch a service key in the anon slot). */
function jwtRole(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return (JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

const DEV_ONLY = ["FAKE_AUTH", "FAKE_AUTH_CONFIRM_EMAIL", "FAKE_AUTH_MAILBOX_FILE", "FAKE_ADMIN_EMAILS", "AI_FAKE"] as const;
const INTS = ["AI_RATE_PER_MINUTE", "AI_RATE_PER_DAY", "AI_GLOBAL_PER_DAY", "AI_MAX_OUTPUT_TOKENS", "AI_TIMEOUT_MS"] as const;

export function checkProductionEnv(env: Env): PreflightFinding[] {
  const out: PreflightFinding[] = [];
  const add = (severity: Severity, subject: string, message: string) => out.push({ severity, subject, message });

  // ── public site URL ──────────────────────────────────────────────────────────────────────
  const site = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!site) add("error", "NEXT_PUBLIC_SITE_URL", "Not set. Canonical URLs, hreflang, the sitemap and the links in sign-up e-mails need your public https domain (Production scope only).");
  else {
    try {
      const url = new URL(site);
      if (url.protocol !== "https:") add("error", "NEXT_PUBLIC_SITE_URL", "Must be https:// in production.");
      if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) add("error", "NEXT_PUBLIC_SITE_URL", "Points at localhost; canonical URLs and e-mail links would be wrong.");
      if (url.pathname !== "/" || url.search || url.hash) add("error", "NEXT_PUBLIC_SITE_URL", "Must be an origin only (no path, query or hash), e.g. https://tahsilradar.az.");
      if (/\.vercel\.app$/.test(url.hostname)) add("warning", "NEXT_PUBLIC_SITE_URL", "A *.vercel.app address is fine for a pilot, but use your own domain before search engines index the site.");
    } catch {
      add("error", "NEXT_PUBLIC_SITE_URL", "Not a valid URL.");
    }
  }

  // ── Supabase ─────────────────────────────────────────────────────────────────────────────
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!isSet(url) && !isSet(anon)) add("error", "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY", "Not set. Without Supabase a production build has no data and no authentication.");
  else if (!isSet(url) || !isSet(anon)) add("error", "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY", "Only one of the two is set; the app refuses to start half-configured.");
  else {
    try {
      const u = new URL(url.trim());
      if (u.protocol !== "https:") add("error", "NEXT_PUBLIC_SUPABASE_URL", "Must be https:// (http is only for the local stack).");
      if (/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) add("error", "NEXT_PUBLIC_SUPABASE_URL", "Points at a local Supabase stack, not your hosted project.");
    } catch {
      add("error", "NEXT_PUBLIC_SUPABASE_URL", "Not a valid URL.");
    }
    const key = anon.trim();
    if (jwtRole(key) === "service_role" || key.startsWith("sb_secret_")) add("error", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "This is a SERVICE-ROLE / secret key. It would be public in the browser and bypass row level security. Use the anon / publishable key and rotate the leaked one now.");
  }

  // ── secrets must never be public ─────────────────────────────────────────────────────────
  for (const name of Object.keys(env)) {
    if (name.startsWith("NEXT_PUBLIC_") && /SERVICE_ROLE|SECRET|ANTHROPIC|PRIVATE|PASSWORD|TOKEN/i.test(name)) {
      add("error", name, "A NEXT_PUBLIC_ variable is embedded in the browser bundle; its name suggests a secret. Rename it without the prefix.");
    }
  }
  if (isSet(env.SUPABASE_SERVICE_ROLE_KEY)) add("warning", "SUPABASE_SERVICE_ROLE_KEY", "Set, but the application does not use it. Remove it from Vercel: an unused key that bypasses row level security is only risk.");

  // ── demo content and development switches ───────────────────────────────────────────────
  const demo = env.SHOW_DEMO_CONTENT?.trim().toLowerCase();
  if (demo === "true") add("error", "SHOW_DEMO_CONTENT", "Is true. Fictional demo records would be shown on the production site. Set it to false (or remove it).");
  else if (demo !== "false") add("info", "SHOW_DEMO_CONTENT", "Not set: with Supabase configured, demo records are hidden in a production build. Set it explicitly to false to make that visible in the Vercel settings.");
  for (const name of DEV_ONLY) if (isSet(env[name]) || env[name] === "0" || env[name] === "1") add("error", name, "Development-only switch. Remove it from the production environment.");
  if (isSet(env.TEST_DATABASE_URL)) add("warning", "TEST_DATABASE_URL", "A superuser database URL for tests. It must not exist in production.");

  // ── contact channel ─────────────────────────────────────────────────────────────────────
  if (!env.NEXT_PUBLIC_CONTACT_EMAIL?.trim()) add("warning", "NEXT_PUBLIC_CONTACT_EMAIL", "Not set: the Contact page still says its form is not active and offers visitors no way to reach you. Set a real mailbox (shown publicly).");
  else if (!getContactEmail(env)) add("warning", "NEXT_PUBLIC_CONTACT_EMAIL", "Set but not a usable address (malformed or a placeholder); the Contact page ignores it.");

  // ── AI (optional) ────────────────────────────────────────────────────────────────────────
  const aiOff = env.AI_ENABLED?.trim().toLowerCase() === "false";
  if (aiOff) add("info", "AI_ENABLED", "false: AI explanations are off. Rule-based matching still works.");
  else if (!isSet(env.ANTHROPIC_API_KEY)) add("info", "ANTHROPIC_API_KEY", "Not set: AI explanations are unavailable (the site works without them).");
  else {
    if (!env.ANTHROPIC_API_KEY!.trim().startsWith("sk-ant-")) add("warning", "ANTHROPIC_API_KEY", "Does not look like an Anthropic key (expected to start with sk-ant-).");
    add("info", "ANTHROPIC_API_KEY", "Set. Remember: limits are per server instance (see KNOWN_LIMITATIONS.md); set a spend limit at the provider.");
  }
  for (const name of INTS) {
    const v = env[name]?.trim();
    if (v !== undefined && v !== "" && !/^[1-9]\d*$/.test(v)) add("warning", name, "Not a positive whole number; the default will be used.");
  }

  return out;
}

export const hasErrors = (findings: readonly PreflightFinding[]) => findings.some((f) => f.severity === "error");
