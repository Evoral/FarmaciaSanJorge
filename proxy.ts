/**
 * Optimistic auth guard (plan §8: "proxy.ts optimista"; FASE 2 point 2.1).
 *
 * DELIBERATELY DOES NOT QUERY THE DATABASE -- Proxy is not meant for slow
 * data fetching (node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md,
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
 * All this does: if the session cookie is entirely absent, redirect to
 * /login before rendering anything, so a signed-out visitor doesn't see a
 * flash of a page that would immediately bounce anyway. A forged, expired,
 * or revoked cookie still passes this check -- it is only caught for real
 * downstream by `requireSession()`.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/modules/auth/domain/cookie-policy";

/** Paths reachable without a session -- excluded from the redirect below. */
const PUBLIC_PATHS = ["/login", "/activar"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function proxy(request: NextRequest): NextResponse | undefined {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return undefined;
  }

  if (!request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return undefined;
}

export const config = {
  matcher: [
    // Exclude API routes (their responses are JSON, not HTML -- a redirect
    // here would be the wrong response shape; route handlers call
    // requireSession() themselves), static assets, image optimization,
    // and well-known metadata files. Everything else runs through
    // `proxy()` above, which itself exempts /login and /activar.
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
