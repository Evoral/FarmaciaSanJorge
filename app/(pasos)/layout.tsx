/**
 * Layout for the steps a session must complete before using the app
 * (`/cambiar-password`, `/configurar-pin` -- openspec/specs/contrasena-temporal/spec.md).
 * No sidebar: until the steps are done the app is not reachable anyway
 * (`app/(app)/layout.tsx` sends the session here). It opts out of the pending-steps
 * gate in `requireSession` because it is the page that resolves them; the pages
 * redirect away when there is nothing (or something else) pending.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession, clearSessionCookie } from "@/shared/auth/session";
import { AuthenticationError } from "@/shared/errors";
import { logout } from "@/modules/auth/application/logout";
import { BrandHeader } from "@/shared/ui/brand-header";

export const dynamic = "force-dynamic";

export default async function PasosLayout({ children }: { children: ReactNode }) {
  let session;
  try {
    session = await requireSession({ permitirPasosPendientes: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      redirect("/login");
    }
    throw error;
  }

  async function logoutAction() {
    "use server";
    await logout();
    await clearSessionCookie();
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <BrandHeader />
      </div>
      <div className="card w-full max-w-md p-6 sm:p-8">{children}</div>
      <div className="mt-6 flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
        <span>
          {session.usuario.nombre} {session.usuario.apellido}
        </span>
        <form action={logoutAction}>
          <button type="submit" className="btn btn-secondary btn-sm">
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}
