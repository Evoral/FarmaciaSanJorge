/**
 * `/` -- home dashboard (FASE 13 point 13.1, user decision 1). Replaces the
 * unmodified `create-next-app` scaffold that used to sit at `app/page.tsx`
 * (deleted -- it collided with this route since route groups like `(app)`
 * don't add a URL segment). Login already redirects here
 * (`app/(auth)/login/actions.ts`'s `redirect("/")`), and this route is
 * covered by `app/(app)/layout.tsx`'s `requireSession()` guard.
 *
 * Single page of cards; each card renders ONLY if the session holds the
 * permiso its own query requires -- no hardcoded per-role dashboards (the
 * gating table is `shared/dashboard/cards.ts#CARD_PERMISO`, unit-tested
 * directly). Each card's fetch is independently try/caught (fail-soft,
 * same discipline as the three banners in `app/(app)/layout.tsx`) so one
 * failing card never breaks the rest of the page.
 */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getLogger } from "@/shared/logging/logger";
import { visibleDashboardCards } from "@/shared/dashboard/cards";
import { resumenJornadasPendientes } from "@/modules/cierres/application/list-jornadas-pendientes";
import { resumenDestruccion } from "@/modules/archivo/application/resumen-destruccion";
import { resumenRegularizacion } from "@/modules/entregas/application/list-regularizacion";
import { alertasStock } from "@/modules/stock/application/alertas-stock";
import { listPreparaciones } from "@/modules/preparaciones/application/list-preparaciones";
import { listEntregasPendientes } from "@/modules/entregas/application/list-entregas-pendientes";
import { resumenRecetasPorEstado } from "@/modules/recetas/application/list-recetas";
import { listUsuarios } from "@/modules/usuarios/application/list-usuarios";

interface Card {
  titulo: string;
  href: string;
  cuerpo: string;
  tono: "neutral" | "amber" | "red";
}

/** Runs `fetch()` only when `visible` is true, swallowing any error into `null` (fail-soft) -- same shape as the three banners in `app/(app)/layout.tsx`. */
async function fetchSoft<T>(visible: boolean, label: string, fetch: () => Promise<T>): Promise<T | null> {
  if (!visible) return null;
  try {
    return await fetch();
  } catch (error) {
    getLogger().error({ error }, `Failed to load dashboard card data: ${label}`);
    return null;
  }
}

export default async function HomePage() {
  const session = await requireSession();
  const visible = new Set(visibleDashboardCards((permiso) => can(session, permiso)));

  const [cierres, archivo, regularizacion, stock, preparaciones, entregas, recetas, usuariosPendientes, usuariosSuspendidos] = await Promise.all([
    fetchSoft(visible.has("cierresPendientes"), "cierresPendientes", () => resumenJornadasPendientes()),
    fetchSoft(visible.has("archivoPlazoCumplido"), "archivoPlazoCumplido", () => resumenDestruccion()),
    fetchSoft(visible.has("regularizacion"), "regularizacion", () => resumenRegularizacion()),
    fetchSoft(visible.has("stockAlertas"), "stockAlertas", () => alertasStock()),
    fetchSoft(visible.has("preparacionesIniciadas"), "preparacionesIniciadas", () => listPreparaciones({ estado: "INICIADA", page: 1, pageSize: 1 })),
    fetchSoft(visible.has("entregasPendientes"), "entregasPendientes", () => listEntregasPendientes({ page: 1, pageSize: 1 })),
    fetchSoft(visible.has("recetasPorEstado"), "recetasPorEstado", () => resumenRecetasPorEstado()),
    fetchSoft(visible.has("usuariosPendientes"), "usuariosPendientes", () => listUsuarios({ estado: "PENDIENTE_ACTIVACION", page: 1, pageSize: 1 })),
    fetchSoft(visible.has("usuariosPendientes"), "usuariosSuspendidos", () => listUsuarios({ estado: "SUSPENDIDO", page: 1, pageSize: 1 })),
  ]);

  const cards: Card[] = [];

  if (cierres) {
    cards.push({
      titulo: "Jornadas pendientes de firma",
      href: "/cierres",
      cuerpo: cierres.cantidad === 0 ? "Sin jornadas pendientes." : `${cierres.cantidad} jornada${cierres.cantidad === 1 ? "" : "s"} pendiente${cierres.cantidad === 1 ? "" : "s"} de firma.`,
      tono: cierres.cantidad === 0 ? "neutral" : cierres.masAntigua?.fueraDeTermino ? "red" : "amber",
    });
  }

  if (archivo) {
    cards.push({
      titulo: "Lotes con plazo cumplido",
      href: "/archivo",
      cuerpo: archivo.cantidad === 0 ? "Sin lotes con plazo cumplido." : `${archivo.cantidad} lote${archivo.cantidad === 1 ? "" : "s"} con plazo cumplido pendiente de destrucción.`,
      tono: archivo.cantidad === 0 ? "neutral" : "amber",
    });
  }

  if (regularizacion) {
    cards.push({
      titulo: "Recetas pendientes de regularización",
      href: "/regularizacion",
      cuerpo:
        regularizacion.cantidad === 0
          ? "Sin recetas pendientes de regularizar."
          : `${regularizacion.cantidad} pendiente${regularizacion.cantidad === 1 ? "" : "s"} (${regularizacion.vencidas} vencida${regularizacion.vencidas === 1 ? "" : "s"}).`,
      tono: regularizacion.cantidad === 0 ? "neutral" : regularizacion.vencidas > 0 ? "red" : "amber",
    });
  }

  if (stock) {
    const total = stock.bajoMinimo.length + stock.porVencer.length + stock.vencidasConSaldo.length;
    cards.push({
      titulo: "Alertas de stock",
      href: "/stock",
      cuerpo:
        total === 0
          ? "Sin alertas de stock."
          : `${stock.bajoMinimo.length} bajo mínimo · ${stock.porVencer.length} por vencer · ${stock.vencidasConSaldo.length} vencidas con saldo.`,
      tono: total === 0 ? "neutral" : stock.vencidasConSaldo.length > 0 ? "red" : "amber",
    });
  }

  if (preparaciones) {
    cards.push({
      titulo: "Preparaciones iniciadas",
      href: "/preparaciones",
      cuerpo: preparaciones.total === 0 ? "Sin preparaciones iniciadas." : `${preparaciones.total} preparación${preparaciones.total === 1 ? "" : "es"} iniciada${preparaciones.total === 1 ? "" : "s"}.`,
      tono: preparaciones.total === 0 ? "neutral" : "amber",
    });
  }

  if (entregas) {
    cards.push({
      titulo: "Entregas pendientes",
      href: "/entregas",
      cuerpo: entregas.total === 0 ? "Sin entregas pendientes." : `${entregas.total} receta${entregas.total === 1 ? "" : "s"} lista${entregas.total === 1 ? "" : "s"} para retirar o pendiente${entregas.total === 1 ? "" : "s"} de firma.`,
      tono: entregas.total === 0 ? "neutral" : "amber",
    });
  }

  if (recetas) {
    const activas = recetas.filter((r) => r.estado !== "ENTREGADA" && r.estado !== "ANULADA").reduce((acc, r) => acc + r.cantidad, 0);
    cards.push({
      titulo: "Recetas por estado",
      href: "/recetas",
      cuerpo: `${activas} receta${activas === 1 ? "" : "s"} activa${activas === 1 ? "" : "s"} (no entregadas ni anuladas).`,
      tono: "neutral",
    });
  }

  if (usuariosPendientes || usuariosSuspendidos) {
    const pendientes = usuariosPendientes?.total ?? 0;
    const suspendidos = usuariosSuspendidos?.total ?? 0;
    cards.push({
      titulo: "Usuarios",
      href: "/admin/usuarios",
      cuerpo: pendientes === 0 && suspendidos === 0 ? "Sin usuarios pendientes ni suspendidos." : `${pendientes} pendiente${pendientes === 1 ? "" : "s"} de activación · ${suspendidos} suspendido${suspendidos === 1 ? "" : "s"}.`,
      tono: pendientes === 0 && suspendidos === 0 ? "neutral" : "amber",
    });
  }

  const toneClasses: Record<Card["tono"], { dot: string; label: string | null }> = {
    neutral: { dot: "bg-emerald-500", label: null },
    amber: { dot: "bg-amber-600", label: "Requiere atención" },
    red: { dot: "bg-red-600", label: "Urgente" },
  };

  return (
    <div className="page">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Inicio</h1>
        <p className="mt-1 text-sm text-zinc-500">Resumen del laboratorio según tus permisos.</p>
      </div>

      {cards.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No hay información para mostrar con tus permisos actuales.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const tone = toneClasses[card.tono];
            return (
              <Link
                key={card.href + card.titulo}
                href={card.href}
                className="card group flex flex-col gap-2 p-5 text-sm transition-[border-color,box-shadow] hover:border-zinc-300 hover:shadow-sm dark:hover:border-zinc-700"
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={`size-2 rounded-full ${tone.dot}`} />
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{card.titulo}</p>
                  {tone.label ? <span className={`badge ml-auto ${card.tono === "red" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}>{tone.label}</span> : null}
                </div>
                <p className="text-zinc-600 dark:text-zinc-400">{card.cuerpo}</p>
                <span className="mt-auto pt-1 text-xs font-medium text-emerald-700 group-hover:underline dark:text-emerald-400">Ver detalle →</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
