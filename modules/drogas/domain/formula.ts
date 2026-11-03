/**
 * A droga's fórmula (openspec/changes/lotes-elaborados, spec elaboracion-lote EL3): its components per
 * `cantidadReferencia` of the product, every quantity in its droga's unidad base. Pure. The database re-checks the one
 * level rule (migration 0111, INV-EL5).
 */
import { Decimal, dec } from "@/shared/decimal";
import { DomainError } from "@/shared/errors";

export interface ComponenteFormula {
  drogaId: string;
  drogaNombre: string;
  /** The component droga's unidad base. */
  cantidad: Decimal | string;
}

export interface Formula {
  drogaId: string;
  /** The produced droga's unidad base. */
  cantidadReferencia: Decimal | string;
  componentes: readonly ComponenteFormula[];
}

export interface ComponenteEscalado {
  drogaId: string;
  drogaNombre: string;
  cantidad: Decimal;
}

/** The precarga of "Elaborar lote": each component scaled to `cantidad` of the product (EL3). */
export function escalarFormula(formula: Formula, cantidad: Decimal | string): ComponenteEscalado[] {
  const factor = dec(cantidad).dividedBy(dec(formula.cantidadReferencia));
  return formula.componentes.map((c) => ({ drogaId: c.drogaId, drogaNombre: c.drogaNombre, cantidad: dec(c.cantidad).times(factor) }));
}

export interface ValidarFormulaInput extends Formula {
  /** Drogas (by id) that have their own fórmula: none can be a component (one level). */
  drogasConFormula: ReadonlySet<string>;
  /** Names of the fórmulas this droga is already a component of: then it cannot have its own. */
  esComponenteDe: readonly string[];
}

/**
 * EL3 / INV-EL5: cantidadReferencia > 0, at least one component, each > 0, none repeated, never the droga itself nor a
 * droga with its own fórmula, and the droga is not itself a component of another fórmula. Throws `DomainError` with the
 * offending field(s): `cantidadReferencia`, `componentes`, `componente_<drogaId>`.
 */
export function validarFormula(input: ValidarFormulaInput): void {
  const referencia = dec(input.cantidadReferencia);
  if (!referencia.isFinite() || !referencia.greaterThan(0)) {
    throw new DomainError("La cantidad de referencia debe ser mayor que 0.", { fields: ["cantidadReferencia"] });
  }
  if (input.esComponenteDe.length > 0) {
    throw new DomainError(`Esta droga es componente de ${input.esComponenteDe.join(", ")}: no puede tener su propia fórmula.`, { fields: ["componentes"] });
  }
  if (input.componentes.length === 0) {
    throw new DomainError("La fórmula necesita al menos un componente.", { fields: ["componentes"] });
  }

  const vistas = new Set<string>();
  for (const c of input.componentes) {
    const campo = `componente_${c.drogaId}`;
    if (c.drogaId === input.drogaId) {
      throw new DomainError("Una fórmula no puede tener a su propia droga como componente.", { fields: [campo] });
    }
    if (vistas.has(c.drogaId)) {
      throw new DomainError(`${c.drogaNombre} está repetida en la fórmula.`, { fields: [campo] });
    }
    vistas.add(c.drogaId);
    if (input.drogasConFormula.has(c.drogaId)) {
      throw new DomainError(`${c.drogaNombre} tiene su propia fórmula: no puede ser componente de otra.`, { fields: [campo] });
    }
    const cantidad = dec(c.cantidad);
    if (!cantidad.isFinite() || !cantidad.greaterThan(0)) {
      throw new DomainError(`La cantidad de ${c.drogaNombre} debe ser mayor que 0.`, { fields: [campo] });
    }
  }
}
