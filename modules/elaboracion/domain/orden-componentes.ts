/**
 * The order an item's componentes are shown and calculated in. Every reader that lists them -- the ficha técnica's
 * lines, the etiqueta's Rp/, the receta detail, the preparación screens, the paciente's history -- sorts them with
 * this ONE rule: the order they were loaded in (`posicion`, migration 0129; no reorder control, the receta is loaded
 * again to change it). Componentes loaded before 0129 have no `posicion` and keep the old rule: componentes with a
 * quantity (TOTAL / POR_DOSIS / CONCENTRACION) first, then CS, then the CSP last; ties by droga name. Pure, no I/O.
 */
import type { ModoExpresion } from "./calcular-ficha-tecnica";

export interface ComponenteOrdenable {
  modoExpresion: ModoExpresion;
  drogaNombre: string;
  /** 0-based load order (migration 0129); null/omitted = loaded before it. Every reader of saved componentes passes it. */
  posicion?: number | null;
}

const RANGO_MODO: Readonly<Record<ModoExpresion, number>> = { TOTAL: 0, POR_DOSIS: 0, CONCENTRACION: 0, CS: 1, CSP: 2 };

function compararComponentes(a: ComponenteOrdenable, b: ComponenteOrdenable): number {
  if (a.posicion != null && b.posicion != null && a.posicion !== b.posicion) return a.posicion - b.posicion;
  return RANGO_MODO[a.modoExpresion] - RANGO_MODO[b.modoExpresion] || a.drogaNombre.localeCompare(b.drogaNombre, "es", { sensitivity: "base" });
}

/** A sorted copy of `componentes` (see the module doc comment). */
export function ordenarComponentes<T extends ComponenteOrdenable>(componentes: readonly T[]): T[] {
  return [...componentes].sort(compararComponentes);
}
