/**
 * Layout for every authenticated route (plan §7: "guardas de layout
 * server-side por permiso" -- this is the session-only half; per-permiso
 * guards belong to each module's own layout once those modules exist).
 * `requireSession()` is the real boundary (proxy.ts is only the
 * optimistic, cookie-presence redirect) -- see modules/auth/application/
 * require-session.ts.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession, clearSessionCookie } from "@/shared/auth/session";
import { AuthenticationError } from "@/shared/errors";
import { logout } from "@/modules/auth/application/logout";

export default async function AppLayout({ children }: { children: ReactNode }) {
  let session;
  try {
    session = await requireSession();
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
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {session.usuario.nombre} {session.usuario.apellido}
        </span>
        <form action={logoutAction}>
          <button type="submit" className="text-sm underline">
            Cerrar sesión
          </button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}
