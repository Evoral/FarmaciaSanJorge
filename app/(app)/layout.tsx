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
import { resumenRegularizacion } from "@/modules/entregas/application/list-regularizacion";
import { resumenDestruccion } from "@/modules/archivo/application/resumen-destruccion";
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

  // FASE 11 point 11.3: same fail-soft, cheap-aggregate discipline as the
  // cierres banner above, gated on the exact permiso the underlying query
  // enforces (`regularizacion.ver`).
  const puedeRegularizacion = can(session, "regularizacion.ver");
  let resumenRegulariz: Awaited<ReturnType<typeof resumenRegularizacion>> | null = null;
  if (puedeRegularizacion) {
    try {
      resumenRegulariz = await resumenRegularizacion();
    } catch (error) {
      getLogger().error({ error }, "Failed to load regularizacion pending-recetas banner summary");
      resumenRegulariz = null;
    }
  }

  // FASE 12 point 12.2: same fail-soft, cheap-aggregate discipline as the
  // cierres/regularizacion banners above, gated on the exact permiso the
  // underlying query enforces (`archivo.destruccion.gestionar`).
  const puedeDestruccionArchivo = can(session, "archivo.destruccion.gestionar");
  let resumenDestruccionArchivo: Awaited<ReturnType<typeof resumenDestruccion>> | null = null;
  if (puedeDestruccionArchivo) {
    try {
      resumenDestruccionArchivo = await resumenDestruccion();
    } catch (error) {
      getLogger().error({ error }, "Failed to load archivo destruccion-pendiente banner summary");
      resumenDestruccionArchivo = null;
    }
  }

  // FASE 12 nav entry: "Archivo" is visible ONLY to archivo.lotes.gestionar
  // -- same permiso `app/(app)/archivo/layout.tsx`'s guard requires, so the
  // link never sends a destruccion.gestionar-only session into a layout
  // guard that would just redirect it back out (both permisos are
  // DIRECTOR_TECNICO-only today regardless).
  const puedeArchivo = can(session, "archivo.lotes.gestionar");

  // FASE 11 nav entry: "Entregas" is visible to entregas.registrar OR
  // regularizacion.ver (task's explicit rule) but the two lead to
  // different routes -- same priority-order pattern as `catalogosHref`
  // above, so the link never sends a regularizacion.ver-only session into
  // `/entregas`'s own layout guard (which redirects it back out).
  const entregasHref = can(session, "entregas.registrar") ? "/entregas" : puedeRegularizacion ? "/regularizacion" : null;

  // FASE 13 point 13.1/13.4 (user decision 5): "Reportes" is shown if the
  // session holds ANY of the report-ish permisos the /reportes hub links
  // to. Deliberately does NOT include `archivo.lotes.gestionar`/
  // `entregas.registrar`/`preparaciones.iniciar` (those already have their
  // own dedicated nav entries, not report entries).
  const puedeReportes =
    can(session, "reportes.ver") ||
    can(session, "stock.valorizado.ver") ||
    can(session, "stock.ver") ||
    can(session, "cierres.reporte") ||
    can(session, "reportes.auditoria") ||
    can(session, "reportes.usuarios");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-6">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {session.usuario.nombre} {session.usuario.apellido}
          </span>
          <HeaderNav
            puedeAuditoria={can(session, "auditoria.ver")}
            puedeReportes={puedeReportes}
            catalogosHref={catalogosHref}
            puedeStock={can(session, "stock.ver")}
            puedeRecetas={can(session, "recetas.crear")}
            puedePreparaciones={can(session, "preparaciones.iniciar")}
            puedeLibro={can(session, "libro.ver")}
            puedeCierres={puedeCierres}
            entregasHref={entregasHref}
            puedeArchivo={puedeArchivo}
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
      {resumenRegulariz && resumenRegulariz.cantidad > 0 ? (
        <div
          role="status"
          className={
            resumenRegulariz.vencidas > 0
              ? "border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
              : "border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          }
        >
          {resumenRegulariz.cantidad} receta{resumenRegulariz.cantidad === 1 ? "" : "s"} pendiente{resumenRegulariz.cantidad === 1 ? "" : "s"} de
          regularizar ({resumenRegulariz.vencidas} vencida{resumenRegulariz.vencidas === 1 ? "" : "s"}).{" "}
          <Link href="/regularizacion" className="underline">
            Ver regularización
          </Link>
        </div>
      ) : null}
      {/*
        The link below only makes sense for a session that can actually
        open `/archivo` (`archivo.lotes.gestionar`, same permiso
        `app/(app)/archivo/layout.tsx`'s guard requires) -- a session with
        ONLY `archivo.destruccion.gestionar` would otherwise see a "Ver
        archivo" link that redirects it straight back out. Hide the whole
        banner in that case instead of showing a dead link (both permisos
        are DIRECTOR_TECNICO-only today regardless, so this never fires
        in practice yet).
      */}
      {resumenDestruccionArchivo && resumenDestruccionArchivo.cantidad > 0 && can(session, "archivo.lotes.gestionar") ? (
        <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {resumenDestruccionArchivo.cantidad} lote{resumenDestruccionArchivo.cantidad === 1 ? "" : "s"} con plazo cumplido pendiente{resumenDestruccionArchivo.cantidad === 1 ? "" : "s"} de destrucción.{" "}
          <Link href="/archivo" className="underline">
            Ver archivo
          </Link>
        </div>
      ) : null}
      <main>{children}</main>
    </div>
  );
}
