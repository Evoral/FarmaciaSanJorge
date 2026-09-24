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
import Link from "next/link";
import { requireSession, clearSessionCookie } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { AuthenticationError } from "@/shared/errors";
import { logout } from "@/modules/auth/application/logout";
import { resumenJornadasPendientes } from "@/modules/cierres/application/list-jornadas-pendientes";
import { getLogger } from "@/shared/logging/logger";
import { HeaderNav } from "./header-nav";

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

  // FASE 4 points 4.2-4.5: same priority order as
  // app/(app)/catalogos/catalogos-nav.tsx's link list -- the first section
  // this session can actually reach, so the header's "Catálogos" link
  // never sends a médicos/pacientes-only role (ATENCION_PUBLICO) into a
  // /catalogos/drogas layout guard that would just redirect it back out.
  const catalogosHref = can(session, "drogas.editar")
    ? "/catalogos/drogas"
    : can(session, "proveedores.gestionar")
      ? "/catalogos/proveedores"
      : can(session, "medicos.gestionar")
        ? "/catalogos/medicos"
        : can(session, "pacientes.gestionar")
          ? "/catalogos/pacientes"
          : null;

  // FASE 10 point 10.3: cheap banner for anyone who can see or sign
  // cierres. Gated on exactly the permiso the underlying query enforces
  // (`cierres.ver` -- see list-jornadas-pendientes.ts's defineQuery) so this
  // check never drifts from what the query itself would allow; every role
  // that can firmar already holds `cierres.ver` too (the seed grants DT
  // both), so this single permiso still covers every audience the task
  // names. The fetch is fail-soft: a banner failure must never break page
  // rendering for the rest of the app.
  const puedeCierres = can(session, "cierres.ver");
  let resumenCierres: Awaited<ReturnType<typeof resumenJornadasPendientes>> | null = null;
  if (puedeCierres) {
    try {
      resumenCierres = await resumenJornadasPendientes();
    } catch (error) {
      getLogger().error({ error }, "Failed to load cierres pending-jornadas banner summary");
      resumenCierres = null;
    }
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-6">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {session.usuario.nombre} {session.usuario.apellido}
          </span>
          <HeaderNav
            puedeAuditoria={can(session, "auditoria.ver")}
            catalogosHref={catalogosHref}
            puedeStock={can(session, "stock.ver")}
            puedeRecetas={can(session, "recetas.crear")}
            puedePreparaciones={can(session, "preparaciones.iniciar")}
            puedeLibro={can(session, "libro.ver")}
            puedeCierres={puedeCierres}
          />
        </div>
        <form action={logoutAction}>
          <button type="submit" className="text-sm underline">
            Cerrar sesión
          </button>
        </form>
      </header>
      {resumenCierres && resumenCierres.cantidad > 0 ? (
        <div
          role="status"
          className={
            resumenCierres.masAntigua?.fueraDeTermino
              ? "border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
              : "border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          }
        >
          {resumenCierres.cantidad} jornada{resumenCierres.cantidad === 1 ? "" : "s"} pendiente{resumenCierres.cantidad === 1 ? "" : "s"} de firma
          {resumenCierres.masAntigua ? ` (la más antigua: ${resumenCierres.masAntigua.fecha}, ${resumenCierres.masAntigua.antiguedadDias} día${resumenCierres.masAntigua.antiguedadDias === 1 ? "" : "s"})` : ""}
          {resumenCierres.masAntigua?.fueraDeTermino ? " — fuera de término" : ""}.{" "}
          <Link href="/cierres" className="underline">
            Ver cierres
          </Link>
        </div>
      ) : null}
      <main>{children}</main>
    </div>
  );
}
