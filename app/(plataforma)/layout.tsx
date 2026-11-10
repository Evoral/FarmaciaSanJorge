/**
 * `/plataforma/**` shell (openspec/specs/plataforma/spec.md P5). No valid platform session:
 *   - with a pharmacy session -> `notFound()`: a pharmacy user cannot tell the panel exists;
 *   - without one -> `/login`, like every other path.
 * This layout does NOT protect Server Actions: every platform use case calls `requireSuperAdmin()` itself (P6).
 * No tenant sidebar, logo or data: the superadmin has no tenant.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { superAdminActual } from "@/shared/auth/plataforma";
import { readSessionCookie } from "@/shared/auth/session";
import { BrandHeader } from "@/shared/ui/brand-header";
import { cerrarSesionPlataformaAction } from "@/modules/plataforma/ui/actions";

export default async function PlataformaLayout({ children }: { children: ReactNode }) {
  const sesion = await superAdminActual();
  if (!sesion) {
    if (await readSessionCookie()) notFound();
    redirect("/login");
  }

  return (
    <div className="min-h-screen w-full min-w-0 max-w-full overflow-x-clip">
      <header className="border-b border-zinc-200/70 dark:border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/plataforma" className="flex min-w-0 items-center gap-3" aria-label="Plataforma: inicio">
            <BrandHeader />
            <span className="text-sm font-semibold text-zinc-500">Plataforma</span>
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-sm text-zinc-700 dark:text-zinc-300" title={sesion.email}>
              {sesion.nombre}
            </span>
            <form action={cerrarSesionPlataformaAction}>
              <button type="submit" aria-label="Cerrar sesión" title="Cerrar sesión" className="glass-icon-btn">
                <LogOut className="size-4" aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto min-w-0 max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
