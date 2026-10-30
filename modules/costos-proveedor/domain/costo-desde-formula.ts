/**
 * R38 (openspec/changes/lotes-elaborados, costos-proveedor delta): a droga without a usable costo de proveedor but
 * with a fórmula is costed from its components' costos de proveedor. Pure. The droga's own costo de proveedor, when
 * usable, wins: the caller only asks here for drogas that have none.
 *
 *   costo per unidad base = Σ componente.cantidad x componente.costoUnitario / cantidadReferencia
 *
 * Both without and with IVA (R7a): the línea is priced with the one with IVA (R25). A component without a usable
 * costo means no price (R27), naming that component.
 */
import { Decimal, dec } from "@/shared/decimal";

export interface ComponenteACostear {
  drogaId: string;
  drogaNombre: string;
  /** The component droga's unidad base. */
  cantidad: Decimal | string;
}

/** A component's usable costo de proveedor, per its droga's unidad base (`CostoProveedorParaCotizar`'s convention). */
export interface CostoDeComponente {
  costoUnitario: Decimal | string;
  costoUnitarioConIva: Decimal | string;
}

export type CostoDesdeFormula =
  | { ok: true; costoUnitario: Decimal; costoUnitarioConIva: Decimal }
  /** Names of the components without a usable costo de proveedor; empty for a fórmula without components. */
  | { ok: false; sinCosto: string[] };

export function costoDesdeFormula(
  formula: { cantidadReferencia: Decimal | string; componentes: readonly ComponenteACostear[] },
  costos: ReadonlyMap<string, CostoDeComponente>,
): CostoDesdeFormula {
  if (formula.componentes.length === 0) return { ok: false, sinCosto: [] };

  const sinCosto = formula.componentes.filter((c) => !costos.has(c.drogaId)).map((c) => c.drogaNombre);
  if (sinCosto.length > 0) return { ok: false, sinCosto };

  const referencia = dec(formula.cantidadReferencia);
  let total = dec(0);
  let totalConIva = dec(0);
  for (const c of formula.componentes) {
    const costo = costos.get(c.drogaId)!;
    total = total.plus(dec(c.cantidad).times(dec(costo.costoUnitario)));
    totalConIva = totalConIva.plus(dec(c.cantidad).times(dec(costo.costoUnitarioConIva)));
  }
  return { ok: true, costoUnitario: total.dividedBy(referencia), costoUnitarioConIva: totalConIva.dividedBy(referencia) };
}
