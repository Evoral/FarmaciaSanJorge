/**
 * The order an item's componentes are shown and calculated in. The
 * componentes of a receta item carry no stored order (migration 0065: the
 * farmacia does not care about it), so every reader that lists them -- the
 * ficha técnica's lines, the etiqueta's Rp/, the receta detail, the
 * preparación screens, the paciente's history -- sorts them with this ONE
 * rule: componentes with a quantity (TOTAL / POR_DOSIS) first, then CS,
 * then the CSP last; ties by droga name. Pure, no I/O.
 */
import type { ModoExpresion } from "./calcular-ficha-tecnica";

export interface ComponenteOrdenable {
  modoExpresion: ModoExpresion;
  drogaNombre: string;
}

const RANGO_MODO: Readonly<Record<ModoExpresion, number>> = { TOTAL: 0, POR_DOSIS: 0, CS: 1, CSP: 2 };

function compararComponentes(a: ComponenteOrdenable, b: ComponenteOrdenable): number {
  return RANGO_MODO[a.modoExpresion] - RANGO_MODO[b.modoExpresion] || a.drogaNombre.localeCompare(b.drogaNombre, "es", { sensitivity: "base" });
}

/** A sorted copy of `componentes` (see the module doc comment). */
export function ordenarComponentes<T extends ComponenteOrdenable>(componentes: readonly T[]): T[] {
  return [...componentes].sort(compararComponentes);
}
