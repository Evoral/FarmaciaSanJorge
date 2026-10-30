/**
 * The costo de proveedor each droga is quoted with (openspec/specs/costos-proveedor/spec.md, R25/R26/R34), for the
 * cotización and the presupuesto of `modules/precios`.
 *
 * NOT a use case: it runs inside the transaction of the caller (`cotizarLineas` / `cotizarItemsAcumulado`, which are
 * themselves called by `cotizaciones.calcular` and `recetas.presupuestar`, already authorized and inside
 * `withTenantTransaction`), so it takes the open `tx` like the repositories do. Read-only: calculating a cotización
 * never writes to `costo_proveedor` (R34). The cotización's permiso (`cotizaciones.ver`/`calcular`) is what lets
 * someone see the proveedor and price used (R37), not `stock.valorizado.ver`.
 */
import type { Prisma } from "@/generated/prisma/client";
import { formulasDeDrogasEnTx } from "@/modules/drogas/application/formula-de-droga";
import { elegirCostoProveedor } from "../domain/costo-proveedor";
import { costoDesdeFormula } from "../domain/costo-desde-formula";
import { getCostosProveedorVigentesDeDrogas } from "../infrastructure/costo-proveedor-repository";

/** The chosen costo, with what the cotización computes with and keeps in its snapshot (R32). */
export interface CostoProveedorParaCotizar {
  costoProveedorId: string;
  proveedorId: string;
  proveedorNombre: string;
  /** The price as written on the supplier's list, per 1 `unidadPrecioSimbolo`. */
  precioInformado: string;
  unidadPrecioSimbolo: string;
  /** Per the droga's unidad base, the same convention as `partida.costo_unitario`. */
  costoUnitario: string;
  /** R7a: percent, and both prices with it; `costoUnitarioConIva` is what the línea is priced with (R25). */
  alicuotaIva: string;
  precioInformadoConIva: string;
  costoUnitarioConIva: string;
  /** `YYYY-MM-DD`. */
  fechaPrecio: string;
}

/**
 * drogaId -> its usable costo de proveedor (R26: vigente, proveedor not de baja; the latest `fecha_precio` wins, a
 * tie goes to the latest `vigente_desde`). A droga with none is ABSENT from the map: the cotización then has no
 * price (R27). ONE query whatever the number of drogas.
 */
export async function costosProveedorParaCotizar(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaIds: readonly string[],
): Promise<Map<string, CostoProveedorParaCotizar>> {
  const candidatos = await getCostosProveedorVigentesDeDrogas(tx, tenantId, drogaIds);
  const porDroga = new Map<string, typeof candidatos>();
  for (const candidato of candidatos) {
    const grupo = porDroga.get(candidato.drogaId);
    if (grupo) grupo.push(candidato);
    else porDroga.set(candidato.drogaId, [candidato]);
  }

  const elegidos = new Map<string, CostoProveedorParaCotizar>();
  for (const [drogaId, grupo] of porDroga) {
    const elegido = elegirCostoProveedor(grupo);
    if (!elegido) continue;
    elegidos.set(drogaId, {
      costoProveedorId: elegido.id,
      proveedorId: elegido.proveedorId,
      proveedorNombre: elegido.proveedorNombre,
      precioInformado: elegido.precioInformado,
      unidadPrecioSimbolo: elegido.unidadPrecioSimbolo,
      costoUnitario: elegido.costoUnitario,
      alicuotaIva: elegido.alicuotaIva,
      precioInformadoConIva: elegido.precioInformadoConIva,
      costoUnitarioConIva: elegido.costoUnitarioConIva,
      fechaPrecio: elegido.fechaPrecio,
    });
  }
  return elegidos;
}

/** R38: what a droga's fórmula costs from its components' costos de proveedor (`CostoFormulaCosteo` of modules/precios). */
export interface CostoFormulaParaCotizar {
  cantidadReferencia: string;
  /** Per the droga's unidad base. */
  costoUnitario: string;
  costoUnitarioConIva: string;
  componentes: { drogaNombre: string; cantidad: string; unidadSimbolo: string; proveedorNombre: string; costoUnitarioConIva: string }[];
}

export interface CostosParaCotizar {
  /** drogaId -> its usable costo de proveedor (R26). */
  proveedor: Map<string, CostoProveedorParaCotizar>;
  /** drogaId -> its fórmula's cost, only for drogas WITHOUT a usable costo de proveedor (R38). */
  formula: Map<string, CostoFormulaParaCotizar>;
  /** drogaId -> the names of its fórmula's components without a costo de proveedor (R27 names them). */
  componentesSinCosto: Map<string, string[]>;
}

/**
 * `costosProveedorParaCotizar` plus the fórmula fallback (R38): a droga without a usable costo de proveedor but with
 * a fórmula is costed from its components' (one level only, INV-EL5: a component never has a fórmula). A droga with
 * neither is absent from both maps (no price, R27). Read-only.
 */
export async function costosParaCotizar(tx: Prisma.TransactionClient, tenantId: string, drogaIds: readonly string[]): Promise<CostosParaCotizar> {
  const proveedor = await costosProveedorParaCotizar(tx, tenantId, drogaIds);
  const formula = new Map<string, CostoFormulaParaCotizar>();
  const componentesSinCosto = new Map<string, string[]>();
  const sinCosto = drogaIds.filter((id) => !proveedor.has(id));
  if (sinCosto.length === 0) return { proveedor, formula, componentesSinCosto };

  const formulas = await formulasDeDrogasEnTx(tx, tenantId, sinCosto);
  if (formulas.size === 0) return { proveedor, formula, componentesSinCosto };
  const componenteIds = [...new Set([...formulas.values()].flatMap((f) => f.componentes.map((c) => c.drogaId)))];
  const costosComponentes = await costosProveedorParaCotizar(tx, tenantId, componenteIds);

  for (const [drogaId, f] of formulas) {
    const resultado = costoDesdeFormula(f, costosComponentes);
    if (!resultado.ok) {
      if (resultado.sinCosto.length > 0) componentesSinCosto.set(drogaId, resultado.sinCosto);
      continue;
    }
    formula.set(drogaId, {
      cantidadReferencia: f.cantidadReferencia,
      costoUnitario: resultado.costoUnitario.toString(),
      costoUnitarioConIva: resultado.costoUnitarioConIva.toString(),
      componentes: f.componentes.map((c) => {
        const costo = costosComponentes.get(c.drogaId)!;
        return { drogaNombre: c.drogaNombre, cantidad: c.cantidad, unidadSimbolo: c.unidadBaseSimbolo, proveedorNombre: costo.proveedorNombre, costoUnitarioConIva: costo.costoUnitarioConIva };
      }),
    });
  }
  return { proveedor, formula, componentesSinCosto };
}
