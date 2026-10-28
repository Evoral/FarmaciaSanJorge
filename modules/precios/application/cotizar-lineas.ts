/**
 * The ONE place ficha lines are costed: loads the tenant's jornada and each
 * droga's partidas (plain reads, never `FOR UPDATE` -- INV-R02) and runs
 * the pure `calcularCotizacion` with the given price rules (precio mínimo +
 * tramos -- domain/regla-precio.ts).
 *
 * Also loads, once per call, the costo de proveedor of each droga
 * (`costosProveedorParaCotizar`, read-only): it is the ONLY price source; a
 * droga without one has no price (openspec/specs/costos-proveedor/spec.md,
 * R25-R27). The partidas only feed the stock faltante.
 *
 * Shared by `cotizaciones.calcular` (`cotizarLineas`: a saved item's latest
 * ficha, persisted as a cotización) and `recetas.presupuestar`
 * (`cotizarItemsAcumulado`: a draft's items computed in memory against the
 * same stock, persisted nowhere -- openspec/specs/presupuesto-receta/spec.md). Not a use
 * case: callers run it inside their own transaction and load the regla
 * themselves (`getReglaVigente`), since "no regla" means an error for one
 * and a message for the other.
 */
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/shared/errors";
import { calcularCotizacion, calcularCotizacionesAcumuladas, mensajeSinCostoProveedor } from "../domain/calcular-cotizacion";
import type { CostoProveedorCosteo, CotizacionCalculada, LineaCosteoInput, PartidaCosteo } from "../domain/calcular-cotizacion";
import { costosProveedorParaCotizar } from "@/modules/costos-proveedor/application/costos-proveedor-para-cotizar";
import type { ReglasPrecio } from "../domain/regla-precio";
import { getPartidasElegiblesDeDroga, getUnidadesBaseDeDrogas, jornadaActualTenant } from "../infrastructure/cotizacion-repository";
import { getReglaVigente } from "../infrastructure/regla-precio-repository";
import type { ReglaVigente } from "../infrastructure/regla-precio-repository";

export type { ReglaVigente };

/** The OPEN regla_precio (its precio mínimo + tramos price every cotización), or `null` when none is configured -- entry point for other modules' application layer. */
export async function cargarReglaPrecioVigente(tx: Prisma.TransactionClient, tenantId: string): Promise<ReglaVigente | null> {
  return getReglaVigente(tx, tenantId);
}

export type CodigoCotizacionNoCalculable = "SIN_REGLA_PRECIO" | "SIN_FICHA" | "SIN_COSTO_PROVEEDOR";

/** Why a cotización cannot be calculated: the same Spanish message as always, plus a stable code. */
export class CotizacionNoCalculableError extends DomainError {
  readonly codigo: CodigoCotizacionNoCalculable;

  constructor(codigo: CodigoCotizacionNoCalculable, message: string) {
    super(message);
    this.codigo = codigo;
  }
}

/** A ficha línea as the callers know it: in its own unit; the droga's unidad base is loaded here. */
export type LineaACostear = Omit<LineaCosteoInput, "unidadStock">;

/**
 * Each línea with its droga's unidad base (`unidadStock`): partidas and their costo unitario are in it, the línea is
 * in its magnitud's base unit. A droga that is not found keeps the línea's own unit (it has no partidas either).
 * Plus its costo de proveedor.
 */
async function conUnidadStock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lineas: readonly LineaACostear[],
  costosProveedor: ReadonlyMap<string, CostoProveedorCosteo>,
): Promise<LineaCosteoInput[]> {
  const unidades = await getUnidadesBaseDeDrogas(tx, tenantId, [...new Set(lineas.map((l) => l.drogaId))]);
  return lineas.map((l) => ({
    ...l,
    unidadStock: unidades.get(l.drogaId) ?? l.unidad,
    costoProveedor: costosProveedor.get(l.drogaId) ?? null,
  }));
}

/**
 * Costs ONE item's `lineas` against the full current stock and prices it with `reglas` (the persisted per-item
 * cotización). Throws `SIN_COSTO_PROVEEDOR` when some droga has no costo de proveedor (R27): no price is stored.
 */
export async function cotizarLineas(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lineas: readonly LineaACostear[],
  reglas: ReglasPrecio,
): Promise<CotizacionCalculada> {
  const jornadaActual = await jornadaActualTenant(tx, tenantId);
  const partidas = new Map<string, PartidaCosteo[]>();
  const drogaIds = [...new Set(lineas.filter((l) => !l.esEnraseManual).map((l) => l.drogaId))];
  for (const drogaId of drogaIds) partidas.set(drogaId, await getPartidasElegiblesDeDroga(tx, tenantId, drogaId));
  const costosProveedor = await costosProveedorParaCotizar(tx, tenantId, drogaIds);
  const cotizacion = calcularCotizacion(await conUnidadStock(tx, tenantId, lineas, costosProveedor), (drogaId) => partidas.get(drogaId) ?? [], jornadaActual, reglas);
  if (cotizacion.drogasSinPrecio.length > 0) {
    throw new CotizacionNoCalculableError("SIN_COSTO_PROVEEDOR", mensajeSinCostoProveedor(cotizacion.drogasSinPrecio));
  }
  return cotizacion;
}

/**
 * Several items of ONE receta costed against the same stock, in order
 * (`calcularCotizacionesAcumuladas`): used by the receta presupuesto so two
 * items needing the same droga cannot both look covered. Same reads as
 * `cotizarLineas`, each droga's partidas read once. Each item is still
 * priced on its OWN cost (tramo + floor per item). An item with a droga
 * without costo de proveedor comes back with `drogasSinPrecio`: the caller
 * shows it without a price (R27).
 */
export async function cotizarItemsAcumulado(
  tx: Prisma.TransactionClient,
  tenantId: string,
  items: readonly (readonly LineaACostear[])[],
  reglas: ReglasPrecio,
): Promise<CotizacionCalculada[]> {
  const jornadaActual = await jornadaActualTenant(tx, tenantId);
  const partidas = new Map<string, PartidaCosteo[]>();
  const drogaIds = [...new Set(items.flatMap((lineas) => lineas.filter((l) => !l.esEnraseManual).map((l) => l.drogaId)))];
  for (const drogaId of drogaIds) partidas.set(drogaId, await getPartidasElegiblesDeDroga(tx, tenantId, drogaId));
  const costosProveedor = await costosProveedorParaCotizar(tx, tenantId, drogaIds);
  const itemsConUnidad: LineaCosteoInput[][] = [];
  for (const lineas of items) itemsConUnidad.push(await conUnidadStock(tx, tenantId, lineas, costosProveedor));
  return calcularCotizacionesAcumuladas(itemsConUnidad, (drogaId) => partidas.get(drogaId) ?? [], jornadaActual, reglas);
}
