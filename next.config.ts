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
  logging: {
    // In development Next prints every Server Function call WITH its arguments.
    // The receta QR import (docs/specs/importacion-receta-qr.md) sends the scanned
    // code, which holds the receta's hash (a bearer capability), as an argument:
    // keep it out of the terminal.
    serverFunctions: false,
  },
  // unpdf ships a serverless pdf.js build (no worker) and loads it with a
  // dynamic `import("unpdf/pdfjs")`; keeping the package out of the server
  // bundle lets Node resolve that import natively instead of relying on the
  // bundler to follow it (modules/recetas/infrastructure/receta-pdf.server.ts).
  serverExternalPackages: ["unpdf"],
  // The etiqueta PDF draws public/logo.png, read from disk at request time
  // (modules/preparaciones/infrastructure/etiqueta-pdf.ts): trace it into
  // that route's serverless bundle.
  outputFileTracingIncludes: {
    "/api/preparaciones/\\[id\\]/etiqueta/pdf": ["./public/logo.png"],
  },
  experimental: {
    serverActions: {
      // docs/specs/importacion-receta-pdf.md: the receta PDF may weigh up to
      // MAX_PDF_BYTES (1 MiB); the raw multipart body adds framing on top,
      // so the limit is that plus MULTIPART_MARGIN_BYTES (32 KiB). Must equal
      // SERVER_ACTIONS_BODY_SIZE_LIMIT_BYTES in
      // modules/recetas/domain/archivo-receta-pdf.ts (asserted by
      // tests/unit/archivo-receta-pdf.test.ts) -- a literal here rather than
      // an import, to keep this config free of app-module imports.
      bodySizeLimit: 1_081_344,
    },
  },
  // Pacientes and Proveedores left the Catálogos tabs to become their own
  // sections under "Gestión": keep old bookmarks/links working. `:path*`
  // also matches the bare paths (zero segments); query strings pass through.
  // Deliberately NOT permanent (307, not 308): these moves may be rolled back
  // (docs/rollbacks/trayectoria-paciente.md) and browsers cache a 308
  // indefinitely, which would keep sending them to a removed route.
  async redirects() {
    return [
      {
        source: "/catalogos/pacientes/:path*",
        destination: "/pacientes/:path*",
        permanent: false,
      },
      {
        source: "/catalogos/proveedores/:path*",
        destination: "/proveedores/:path*",
        permanent: false,
      },
    ];
  },
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
