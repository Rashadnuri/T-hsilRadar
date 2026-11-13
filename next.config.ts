import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Baseline security headers (SECURITY.md §7).
// The Content-Security-Policy below is deliberately PARTIAL: it restricts framing, <base>, plugins and
// form targets, which need no knowledge of Next's inline scripts. A script-src policy (nonce based)
// must be validated together with analytics/Supabase origins and is listed in KNOWN_LIMITATIONS.md.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  // One year, this exact host only (no includeSubDomains / preload: those are an operator's decision).
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Vercel preview / development deployments must never be indexed (robots.txt says so too).
const nonProductionVercel = Boolean(process.env.VERCEL_ENV) && process.env.VERCEL_ENV !== "production";
const noIndexHeader = nonProductionVercel ? [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] : [];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: [...securityHeaders, ...noIndexHeader] },
      // Pages that depend on a session cookie must never be stored by a shared cache / CDN.
      { source: "/:locale(az|ru|en)/:page(profile|my-plan|matches|admin|login|register|forgot-password|reset-password|auth)/:rest*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default withNextIntl(nextConfig);
