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
import { elegirCostoProveedor } from "../domain/costo-proveedor";
import { getAlicuotaIvaPorDefecto, getCostosProveedorVigentesDeDrogas } from "../infrastructure/costo-proveedor-repository";

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
 * The tenant's `alicuota_iva_porcentaje` (R7a, defensive fallback to 21): the IVA a línea costed from partidas gets
 * (R27; a partida's cost is net of IVA). Read-only, inside the caller's transaction.
 */
export async function alicuotaIvaParaCotizar(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  return getAlicuotaIvaPorDefecto(tx, tenantId);
}

/**
 * drogaId -> its usable costo de proveedor (R26: vigente, proveedor not de baja; the latest `fecha_precio` wins, a
 * tie goes to the latest `vigente_desde`). A droga with none is ABSENT from the map: the cotización then costs it
 * from partidas (R27). ONE query whatever the number of drogas.
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
