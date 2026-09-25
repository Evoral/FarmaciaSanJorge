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
import Image from "next/image";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-lg bg-white ring-1 ring-zinc-200 dark:ring-zinc-800">
          <Image src="/logo.png" alt="" width={32} height={32} priority />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-base font-semibold">Laboratorio Magistral</span>
          <span className="text-sm text-zinc-500">Farmacia San Jorge</span>
        </span>
      </div>
      <div className="card w-full max-w-sm p-6 sm:p-8">{children}</div>
    </div>
  );
}
