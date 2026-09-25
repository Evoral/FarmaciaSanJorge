/**
 * Pure permiso-gating for the home dashboard cards (FASE 13 point 13.1,
 * user decision 1: "single page of cards; each card renders only if the
 * user has the permiso its query requires -- no hardcoded per-role
 * dashboards"). Kept in `shared/` (not `app/(app)/page.tsx` itself) so the
 * card-visibility rule is a plain, DB-free function the unit test suite
 * can exercise directly (`tests/unit/**` never includes `app/**`, see
 * `vitest.config.ts`) -- `app/(app)/page.tsx` imports `CARD_PERMISO`
 * directly so the page and the test share the SAME source of truth,
 * never a duplicated permiso list that could drift.
 */
import type { Permiso } from "@/modules/auth/domain/permisos";

export const DASHBOARD_CARD_IDS = [
  "cierresPendientes",
  "archivoPlazoCumplido",
  "regularizacion",
  "stockAlertas",
  "preparacionesIniciadas",
  "entregasPendientes",
  "recetasPorEstado",
  "usuariosPendientes",
] as const;

export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number];

/**
 * The permisos that gate each card, ALL required: the exact permiso the
 * card's underlying query enforces (never a looser/different check), plus
 * the one its link target requires when that differs -- archivoPlazoCumplido
 * reads via `archivo.destruccion.gestionar` but links to `/archivo`, which
 * is gated on `archivo.lotes.gestionar`.
 */
export const CARD_PERMISO: Record<DashboardCardId, readonly Permiso[]> = {
  cierresPendientes: ["cierres.ver"],
  archivoPlazoCumplido: ["archivo.destruccion.gestionar", "archivo.lotes.gestionar"],
  regularizacion: ["regularizacion.ver"],
  stockAlertas: ["stock.ver"],
  preparacionesIniciadas: ["preparaciones.iniciar"],
  entregasPendientes: ["entregas.registrar"],
  recetasPorEstado: ["recetas.crear"],
  usuariosPendientes: ["usuarios.listar"],
};

/** Which cards a session with the given permisos can see, in `DASHBOARD_CARD_IDS` order. `can` is injected so this stays DB/session-free (pure). */
export function visibleDashboardCards(can: (permiso: Permiso) => boolean): DashboardCardId[] {
  return DASHBOARD_CARD_IDS.filter((id) => CARD_PERMISO[id].every(can));
}
