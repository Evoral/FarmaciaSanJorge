/**
 * `shared/dashboard/cards.ts` -- FASE 13 point 13.1, user decision 1: card
 * visibility is a pure function of the session's permisos, no hardcoded
 * per-role list. `app/(app)/page.tsx` imports `CARD_PERMISO`/
 * `visibleDashboardCards` directly, so this test exercises the SAME
 * gating the real dashboard uses (see that file's doc comment).
 */
import { describe, it, expect } from "vitest";
import { visibleDashboardCards, CARD_PERMISO, DASHBOARD_CARD_IDS } from "@/shared/dashboard/cards";
import type { Permiso } from "@/modules/auth/domain/permisos";

function canFrom(permisos: readonly Permiso[]): (permiso: Permiso) => boolean {
  const set = new Set(permisos);
  return (permiso) => set.has(permiso);
}

describe("visibleDashboardCards", () => {
  it("shows no cards for a session with no permisos", () => {
    expect(visibleDashboardCards(canFrom([]))).toEqual([]);
  });

  it("shows exactly the card whose permiso the session holds", () => {
    expect(visibleDashboardCards(canFrom(["stock.ver"]))).toEqual(["stockAlertas"]);
  });

  it("shows every card when the session holds every card's permiso", () => {
    const allPermisos = DASHBOARD_CARD_IDS.flatMap((id) => CARD_PERMISO[id]);
    expect(visibleDashboardCards(canFrom(allPermisos))).toEqual(DASHBOARD_CARD_IDS);
  });

  it("DIRECTOR_TECNICO-shaped grants show cierres/archivo/regularizacion/stock/preparaciones/entregas/recetas but NOT usuarios (usuarios.listar is ADM-only)", () => {
    const dtPermisos: Permiso[] = [
      "cierres.ver",
      "archivo.lotes.gestionar",
      "archivo.destruccion.gestionar",
      "regularizacion.ver",
      "stock.ver",
      "preparaciones.iniciar",
      "entregas.registrar",
      "recetas.crear",
    ];
    expect(visibleDashboardCards(canFrom(dtPermisos))).toEqual([
      "cierresPendientes",
      "archivoPlazoCumplido",
      "regularizacion",
      "stockAlertas",
      "preparacionesIniciadas",
      "entregasPendientes",
      "recetasPorEstado",
    ]);
  });

  it("ADMINISTRADOR-shaped grants show only usuariosPendientes (no cierres/archivo/regularizacion/stock/preparaciones/entregas/recetas permisos)", () => {
    expect(visibleDashboardCards(canFrom(["usuarios.listar"]))).toEqual(["usuariosPendientes"]);
  });

  it("archivoPlazoCumplido needs both the query's permiso and the link target's permiso", () => {
    expect(visibleDashboardCards(canFrom(["archivo.lotes.gestionar"]))).toEqual([]);
    expect(visibleDashboardCards(canFrom(["archivo.destruccion.gestionar"]))).toEqual([]);
    expect(visibleDashboardCards(canFrom(["archivo.lotes.gestionar", "archivo.destruccion.gestionar"]))).toEqual(["archivoPlazoCumplido"]);
  });

  it("every card id maps to at least one permiso (no card silently ungated)", () => {
    for (const id of DASHBOARD_CARD_IDS) {
      expect(CARD_PERMISO[id].length, `card "${id}" has no permiso mapped`).toBeGreaterThan(0);
    }
  });
});
