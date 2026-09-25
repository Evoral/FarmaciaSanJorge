import type { NextConfig } from "next";

/**
 * FASE 14 point 14.1: browser-hardening headers that do NOT depend on a
 * per-request nonce, applied to every path (including `/api/**`, whose
 * responses are JSON/binary but still benefit from HSTS/nosniff/etc. --
 * see docs/deploy.md and proxy.ts's own comment on the split).
 * `Content-Security-Policy` is intentionally NOT set here: it needs a
 * fresh nonce per request and is only meaningful for HTML documents, so
 * it lives in `proxy.ts` instead (which excludes `/api/**` via its
 * matcher).
 *
 * `Strict-Transport-Security` is production-only: it is a one-way,
 * long-lived browser instruction ("only ever use HTTPS for this host,
 * including subdomains") that would actively break `next dev`'s plain
 * HTTP localhost server for the `max-age` of the header if sent in
 * development.
 */
const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Superseded by CSP's `frame-ancestors 'none'` (set in proxy.ts) in
  // modern browsers, but kept for the older browsers/contexts that only
  // understand this header (also required explicitly by FASE 14 point 14.1).
  { key: "X-Frame-Options", value: "DENY" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
