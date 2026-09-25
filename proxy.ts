/**
 * Optimistic auth guard (plan §8: "proxy.ts optimista"; FASE 2 point 2.1)
 * PLUS the per-request nonce-based Content-Security-Policy (FASE 14 point
 * 14.1, node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
 * "Adding a nonce with Proxy").
 *
 * Auth guard: DELIBERATELY DOES NOT QUERY THE DATABASE -- Proxy is not
 * meant for slow data fetching
 * (node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md,
 * "Good to know": "it should not be used as a full session management or
 * authorization solution") -- and MUST NEVER be treated as the real
 * authorization boundary. It only checks whether the session cookie is
 * PRESENT, never whether it is valid, expired, revoked, or belongs to a
 * usuario that is still ACTIVO. That real check is `requireSession()`
 * (modules/auth/application/require-session.ts), which every Server
 * Action / route handler runs via `shared/usecase.ts#defineCommand` /
 * `defineQuery` -- the actual source of truth (plan §7: "Ejecución de
 * acción: authorize(permiso) en cada Server Action / route handler --
 * fuente de verdad").
 *
 * If the session cookie is entirely absent on a non-public path, redirect
 * to /login before rendering anything, so a signed-out visitor doesn't see
 * a flash of a page that would immediately bounce anyway. A forged,
 * expired, or revoked cookie still passes this check -- it is only caught
 * for real downstream by `requireSession()`.
 *
 * CSP: a fresh nonce is generated on every request and set both as a
 * request header (`x-nonce`, so a Server Component can read it via
 * `headers()` if it ever needs to pass it to a manually-authored inline
 * script/style -- none exist in this codebase today; Next.js auto-applies
 * the nonce to its own framework scripts and to `next/font`'s generated
 * `<style>` tags) and as the `Content-Security-Policy` response header.
 * Only `script-src`/`style-src` need the nonce; the other directives are
 * static. `'unsafe-eval'` and `'unsafe-inline'` (for styles) are enabled
 * ONLY in development -- required for React's dev-mode error-stack
 * reconstruction and for Fast Refresh/HMR-injected styles (see the CSP
 * doc's "Development vs Production Considerations"); production never
 * gets them. Route handlers under /api are excluded by `matcher` below
 * (unchanged) -- their responses are JSON/binary (PDF, CSV, the /api/health
 * check), never HTML, so a page-shaped CSP header would be meaningless
 * there; those get the browser-hardening headers that DON'T need a nonce
 * (HSTS, X-Content-Type-Options, etc.) from `next.config.ts#headers()`
 * instead, which applies to every path including /api.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/modules/auth/domain/cookie-policy";

/** Paths reachable without a session -- excluded from the redirect below. */
const PUBLIC_PATHS = ["/login", "/activar"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Builds the CSP header value for one request's nonce. Kept in one place
 * so dev/prod divergence (the only thing that varies request-to-request
 * besides the nonce itself) is easy to audit.
 */
function buildContentSecurityPolicy(nonce: string, isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Dev: Fast Refresh/HMR injects <style> tags Next.js does not nonce
    // itself, so 'unsafe-inline' is required in development only (per the
    // CSP doc). Production keeps the strict nonce-only policy.
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Dev: the webpack/Turbopack HMR client opens a same-origin websocket.
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ];
  return directives.join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = buildContentSecurityPolicy(nonce, isDev);

  if (!isPublicPath(pathname) && !request.cookies.has(SESSION_COOKIE_NAME)) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  // Forwarded as a request header so Next.js can parse the CSP header
  // during SSR and auto-apply the nonce to its own inline tags; also set
  // on the response for the browser to enforce.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Exclude API routes (their responses are JSON/binary, not HTML -- a
    // redirect or an HTML-shaped CSP here would be the wrong response
    // shape; route handlers call requireSession() themselves), static
    // assets, image optimization, and well-known metadata files. Everything
    // else runs through `proxy()` above, which itself exempts /login and
    // /activar from the redirect (but NOT from the CSP header).
    "/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|sitemap.xml|robots.txt).*)",
  ],
};
