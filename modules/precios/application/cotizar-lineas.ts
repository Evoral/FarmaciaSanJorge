/**
 * The ONE place ficha lines are costed: loads the tenant's jornada and each
 * droga's partidas (plain reads, never `FOR UPDATE` -- INV-R02) and runs
 * the pure `calcularCotizacion` with the given price rules (precio mínimo +
 * tramos -- domain/regla-precio.ts).
 *
 * Shared by `cotizaciones.calcular` (`cotizarLineas`: a saved item's latest
 * ficha, persisted as a cotización) and `recetas.presupuestar`
 * (`cotizarItemsAcumulado`: a draft's items computed in memory against the
 * same stock, persisted nowhere -- docs/specs/presupuesto-receta.md). Not a use
 * case: callers run it inside their own transaction and load the regla
 * themselves (`getReglaVigente`), since "no regla" means an error for one
 * and a message for the other.
 */
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/shared/errors";
import { calcularCotizacion, calcularCotizacionesAcumuladas } from "../domain/calcular-cotizacion";
import type { CotizacionCalculada, LineaCosteoInput, PartidaCosteo } from "../domain/calcular-cotizacion";
import type { ReglasPrecio } from "../domain/regla-precio";
import { getPartidasElegiblesDeDroga, jornadaActualTenant } from "../infrastructure/cotizacion-repository";
import { getReglaVigente } from "../infrastructure/regla-precio-repository";
import type { ReglaVigente } from "../infrastructure/regla-precio-repository";

export type { ReglaVigente };

/** The OPEN regla_precio (its precio mínimo + tramos price every cotización), or `null` when none is configured -- entry point for other modules' application layer. */
export async function cargarReglaPrecioVigente(tx: Prisma.TransactionClient, tenantId: string): Promise<ReglaVigente | null> {
  return getReglaVigente(tx, tenantId);
}

export type CodigoCotizacionNoCalculable = "SIN_REGLA_PRECIO" | "SIN_FICHA";

/** Why a cotización cannot be calculated: the same Spanish message as always, plus a stable code. */
export class CotizacionNoCalculableError extends DomainError {
  readonly codigo: CodigoCotizacionNoCalculable;

  constructor(codigo: CodigoCotizacionNoCalculable, message: string) {
    super(message);
    this.codigo = codigo;
  }
}

/** Costs ONE item's `lineas` against the full current stock and prices it with `reglas` (the persisted per-item cotización). */
export async function cotizarLineas(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lineas: readonly LineaCosteoInput[],
  reglas: ReglasPrecio,
): Promise<CotizacionCalculada> {
  const jornadaActual = await jornadaActualTenant(tx, tenantId);
  const partidas = new Map<string, PartidaCosteo[]>();
  const drogaIds = [...new Set(lineas.filter((l) => !l.esEnraseManual).map((l) => l.drogaId))];
  for (const drogaId of drogaIds) partidas.set(drogaId, await getPartidasElegiblesDeDroga(tx, tenantId, drogaId));
  return calcularCotizacion(lineas, (drogaId) => partidas.get(drogaId) ?? [], jornadaActual, reglas);
}

/**
 * Several items of ONE receta costed against the same stock, in order
 * (`calcularCotizacionesAcumuladas`): used by the receta presupuesto so two
 * items needing the same droga cannot both look covered. Same reads as
 * `cotizarLineas`, each droga's partidas read once. Each item is still
 * priced on its OWN cost (tramo + floor per item).
 */
export async function cotizarItemsAcumulado(
  tx: Prisma.TransactionClient,
  tenantId: string,
  items: readonly (readonly LineaCosteoInput[])[],
  reglas: ReglasPrecio,
): Promise<CotizacionCalculada[]> {
  const jornadaActual = await jornadaActualTenant(tx, tenantId);
  const partidas = new Map<string, PartidaCosteo[]>();
  const drogaIds = [...new Set(items.flatMap((lineas) => lineas.filter((l) => !l.esEnraseManual).map((l) => l.drogaId)))];
  for (const drogaId of drogaIds) partidas.set(drogaId, await getPartidasElegiblesDeDroga(tx, tenantId, drogaId));
  return calcularCotizacionesAcumuladas(items, (drogaId) => partidas.get(drogaId) ?? [], jornadaActual, reglas);
}
