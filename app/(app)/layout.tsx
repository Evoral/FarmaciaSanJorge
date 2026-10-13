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
import { cookies } from "next/headers";
import Link from "next/link";
import { requireSession, clearSessionCookie } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { AuthenticationError } from "@/shared/errors";
import { logout } from "@/modules/auth/application/logout";
import { resumenJornadasPendientes } from "@/modules/cierres/application/list-jornadas-pendientes";
import { resumenDestruccion } from "@/modules/archivo/application/resumen-destruccion";
import { resumenVencimientosDrogas } from "@/modules/stock/application/vencimientos-drogas";
import { getLogger } from "@/shared/logging/logger";
import { AppShell } from "./app-shell";
import { SIDEBAR_COLLAPSED_COOKIE } from "./sidebar-state";
import { accesosSections, catalogosSections, configuracionSections, firstSectionHref, gestionDtSections } from "./nav-sections";

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

  // FASE 4 points 4.1-4.5: the first section this session can actually
  // reach, from the SAME list (and priority order) that drives each
  // section's layout guard and tab nav (./nav-sections.ts) -- so the
  // sidebar's "Catálogos" link never sends a médicos-only role
  // (ATENCION_PUBLICO) into a /catalogos/drogas layout guard that would
  // just redirect it back out. Same rule for the "Administración" group's
  // "Usuarios y accesos" and "Configuración" entries.
  const catalogosHref = firstSectionHref(catalogosSections(session));
  const accesosHref = firstSectionHref(accesosSections(session));
  const configuracionHref = firstSectionHref(configuracionSections(session));
  // "Gestión DT" (formerly "Cierres"): same rule, from the /cierres/** tabs.
  const seccionesGestionDt = gestionDtSections(session);
  const gestionDtHref = firstSectionHref(seccionesGestionDt);

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

  // FASE 12 point 12.2: same fail-soft, cheap-aggregate discipline as the
  // cierres banner above, gated on the exact permiso the
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

  // Vencimientos of DROGA partidas (docs/specs/reanalisis-partida.md): same
  // fail-soft, cheap-aggregate discipline, gated on the permiso the query
  // enforces (`stock.ver`) -- everyone who sees stock alerts, so they warn
  // the DT. It links to the "Gestión DT" tab when the session can
  // open it, else to `/stock?vencidas=1` (same permiso as the query).
  const puedeVencimientos = can(session, "stock.ver");
  let resumenVencimientos: Awaited<ReturnType<typeof resumenVencimientosDrogas>> | null = null;
  if (puedeVencimientos) {
    try {
      resumenVencimientos = await resumenVencimientosDrogas();
    } catch (error) {
      getLogger().error({ error }, "Failed to load vencimientos banner summary");
      resumenVencimientos = null;
    }
  }
  const vencimientosHref = seccionesGestionDt.some((seccion) => seccion.href === "/cierres/vencimientos") ? "/cierres/vencimientos" : "/stock?vencidas=1";

  // FASE 12 nav entry: "Archivo" is visible ONLY to archivo.lotes.gestionar
  // -- same permiso `app/(app)/archivo/layout.tsx`'s guard requires, so the
  // link never sends a destruccion.gestionar-only session into a layout
  // guard that would just redirect it back out (both permisos are
  // DIRECTOR_TECNICO-only today regardless).
  const puedeArchivo = can(session, "archivo.lotes.gestionar");

  // FASE 11 nav entry: "Entregas" is visible to entregas.registrar -- the
  // same permiso `/entregas`'s own layout guard requires.
  const entregasHref = can(session, "entregas.registrar") ? "/entregas" : null;

  // FASE 13 point 13.1/13.4 (user decision 5): "Reportes" is shown if the
  // session holds ANY of the report-ish permisos the /reportes hub links
  // to. Deliberately does NOT include `archivo.lotes.gestionar`/
  // `entregas.registrar`/`preparaciones.iniciar` (those already have their
  // own dedicated nav entries, not report entries) nor
  // `reportes.usuarios`: the usuarios listing lives under "Administración
  // › Usuarios y accesos" now, not in the /reportes hub (ADM still gets
  // Reportes through `reportes.auditoria`).
  const puedeReportes =
    can(session, "reportes.ver") ||
    can(session, "stock.valorizado.ver") ||
    can(session, "stock.ver") ||
    can(session, "cierres.reporte") ||
    can(session, "reportes.auditoria");

  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";

  const avisos: Aviso[] = [];
  if (resumenCierres && resumenCierres.cantidad > 0) {
    const { cantidad, masAntigua } = resumenCierres;
    avisos.push({
      key: "cierres",
      tone: masAntigua?.fueraDeTermino ? "danger" : "warn",
      href: "/cierres",
      linkLabel: "Ver firmas",
      content: (
        <>
          <b className="font-semibold tabular-nums">{cantidad}</b> jornada{cantidad === 1 ? "" : "s"} pendiente{cantidad === 1 ? "" : "s"} de firma
          {masAntigua ? ` · la más antigua: ${masAntigua.fecha} (${masAntigua.antiguedadDias} día${masAntigua.antiguedadDias === 1 ? "" : "s"})` : ""}
          {masAntigua?.fueraDeTermino ? " — fuera de término" : ""}
        </>
      ),
    });
  }
  if (resumenVencimientos && (resumenVencimientos.drogasVencidas > 0 || resumenVencimientos.drogasPorVencer > 0)) {
    const { drogasVencidas, drogasPorVencer } = resumenVencimientos;
    avisos.push({
      key: "vencimientos",
      tone: drogasVencidas > 0 ? "danger" : "warn",
      href: vencimientosHref,
      linkLabel: "Ver vencimientos",
      content: (
        <>
          {drogasVencidas > 0 ? (
            <>
              <b className="font-semibold tabular-nums">{drogasVencidas}</b> droga{drogasVencidas === 1 ? "" : "s"} vencida{drogasVencidas === 1 ? "" : "s"}
            </>
          ) : null}
          {drogasVencidas > 0 && drogasPorVencer > 0 ? " · " : null}
          {drogasPorVencer > 0 ? (
            <>
              <b className="font-semibold tabular-nums">{drogasPorVencer}</b> {drogasVencidas > 0 ? "por vencer" : `droga${drogasPorVencer === 1 ? "" : "s"} por vencer`}
            </>
          ) : null}
        </>
      ),
    });
  }
  // The link only makes sense for a session that can open `/archivo`
  // (`archivo.lotes.gestionar`, same permiso `app/(app)/archivo/layout.tsx`'s
  // guard requires): a session with ONLY `archivo.destruccion.gestionar`
  // would otherwise see a link that redirects it straight back out. That
  // item is hidden instead of showing a dead link (both permisos are
  // DIRECTOR_TECNICO-only today regardless).
  if (resumenDestruccionArchivo && resumenDestruccionArchivo.cantidad > 0 && puedeArchivo) {
    const { cantidad } = resumenDestruccionArchivo;
    avisos.push({
      key: "destruccion",
      tone: "warn",
      href: "/archivo",
      linkLabel: "Ver archivo",
      content: (
        <>
          <b className="font-semibold tabular-nums">{cantidad}</b> lote{cantidad === 1 ? "" : "s"} con plazo cumplido pendiente{cantidad === 1 ? "" : "s"} de destrucción
        </>
      ),
    });
  }

  return (
    <AppShell
      initialCollapsed={sidebarCollapsed}
      nav={{
        usuario: `${session.usuario.nombre} ${session.usuario.apellido}`,
        logoutAction,
        cierresPendientes: resumenCierres?.cantidad ?? 0,
        puedeAuditoria: can(session, "auditoria.ver"),
        puedeReportes,
        catalogosHref,
        puedePacientes: can(session, "pacientes.gestionar"),
        puedeProveedores: can(session, "proveedores.gestionar"),
        puedeComparadorCostos: can(session, "stock.valorizado.ver"),
        accesosHref,
        configuracionHref,
        puedeStock: can(session, "stock.ver"),
        puedeRecetas: can(session, "recetas.crear"),
        puedePreparaciones: can(session, "preparaciones.iniciar"),
        puedeLibro: can(session, "libro.ver"),
        gestionDtHref,
        entregasHref,
        puedeArchivo,
      }}
    >
      <NoticeBar avisos={avisos} />
      <main>{children}</main>
    </AppShell>
  );
}

type AvisoTone = "warn" | "danger";

interface Aviso {
  key: string;
  tone: AvisoTone;
  /** `null` when the session cannot open the destination: the item shows without a link, never a dead one. */
  href: string | null;
  linkLabel: string;
  content: ReactNode;
}

/**
 * The app-wide notification bar: ONE shared `.alert` (app/globals.css) holding each pending item as its own segment
 * (count, short text, link, and a dot in its own tone). The bar's tone is the most severe item's. Nothing renders
 * when there is nothing pending.
 */
function NoticeBar({ avisos }: { avisos: readonly Aviso[] }) {
  if (avisos.length === 0) return null;
  const tone: AvisoTone = avisos.some((aviso) => aviso.tone === "danger") ? "danger" : "warn";
  return (
    <div className="notice-bar-wrap">
      <div role="status" className={`alert alert-${tone} notice-bar`}>
        <ul className="notice-bar-items">
          {avisos.map((aviso) => (
            <li key={aviso.key} className="notice-bar-item">
              <span aria-hidden="true" className="notice-bar-dot" data-tone={aviso.tone} />
              <span className="min-w-0">{aviso.content}</span>
              {aviso.href ? (
                <Link href={aviso.href} className="notice-bar-link">
                  {aviso.linkLabel}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
