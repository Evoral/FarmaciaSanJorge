/**
 * Layout for the public, unauthenticated routes (`/login`, `/activar` --
 * see proxy.ts's PUBLIC_PATHS).
 *
 * FASE 14 point 14.1: forces dynamic rendering. Neither `/login` nor
 * `/activar` reads cookies or session data (that's the whole point of
 * being public), so without this Next.js could statically prerender them
 * at build time -- and a statically-generated page has no per-request
 * nonce to inject into the CSP header (node_modules/next/dist/docs/01-app/
 * 02-guides/content-security-policy.md, "Static vs Dynamic Rendering with
 * CSP"). The rest of the app is already dynamic because
 * `app/(app)/layout.tsx` calls `requireSession()`, which reads cookies.
 */
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
