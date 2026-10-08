/**
 * Purity per partida (migration 0058) for the líneas de pesaje the toma
 * workspace shows: the partidas the confirmation would draw a línea from
 * (`listPartidasElegiblesDroga` + `ordenarParaConsumo`: same candidates,
 * same order, vencidas and empty ones left out; stock reserved by any
 * preparación INICIADA is not available, migration 0071) with the PHYSICAL weight
 * each one needs for the línea's `cantidadAPesar` (= active required):
 * `fisicoParaActivo`, domain/potencia.ts -- the same function the
 * confirmation uses.
 *
 * Shared by `preparaciones.toma.ver` (the saved fichas) and
 * `preparaciones.toma.previsualizarFichas` (a draft's fichas, in memory),
 * so a preview lists exactly what the saved ficha will. Not a use case:
 * callers run it inside their own transaction. Plain reads only.
 */
import type { Prisma } from "@/generated/prisma/client";
import { ordenarParaConsumo } from "@/modules/stock/domain/reparto";
import { fisicoParaActivo } from "../domain/potencia";
import { jornadaActualTenant, listPartidasElegiblesDroga } from "../infrastructure/preparacion-repository";
import type { PartidaElegible } from "../infrastructure/preparacion-repository";

/** A partida the línea could be weighed from, with the physical weight it needs. Plain strings (decimal values). */
export interface PartidaParaPesar {
  id: string;
  lote: string;
  proveedorNombre: string;
  /** Percent; `null` = not declared (100%). */
  potenciaDeclarada: string | null;
  cantidadDisponible: string;
  /** PHYSICAL weight of THIS partida for the whole línea: cantidadAPesar x 100 / potencia. */
  cantidadAPesar: string;
}

/** What of a línea decides its partidas. */
export interface LineaPesable {
  drogaId: string;
  cantidadAPesar: string | null;
  esEnraseManual: boolean;
}

/** Each droga's candidate partidas, in consumption order. */
export type PartidasPorDroga = ReadonlyMap<string, readonly PartidaElegible[]>;

/** Manual-enrase líneas and líneas without cantidadAPesar are not weighed from a partida here. */
export function esLineaPesable(linea: LineaPesable): boolean {
  return !linea.esEnraseManual && linea.cantidadAPesar !== null;
}

/** The candidate partidas of every droga in `drogaIds`, loaded once per droga (no query at all when there is none). */
export async function cargarPartidasPorDroga(tx: Prisma.TransactionClient, tenantId: string, drogaIds: Iterable<string>): Promise<PartidasPorDroga> {
  const pendientes = new Set(drogaIds);
  const partidasPorDroga = new Map<string, PartidaElegible[]>();
  if (pendientes.size === 0) return partidasPorDroga;
  const jornada = await jornadaActualTenant(tx, tenantId);
  for (const drogaId of pendientes) {
    partidasPorDroga.set(drogaId, ordenarParaConsumo(await listPartidasElegiblesDroga(tx, tenantId, drogaId), jornada));
  }
  return partidasPorDroga;
}

/** The línea's partidas with what to weigh from each one; `null` for a línea that is not pesable. */
export function partidasDeLinea(partidasPorDroga: PartidasPorDroga, linea: LineaPesable): PartidaParaPesar[] | null {
  const activo = linea.cantidadAPesar;
  if (linea.esEnraseManual || activo === null) return null;
  return (partidasPorDroga.get(linea.drogaId) ?? []).map((p) => ({
    id: p.id,
    lote: p.lote,
    proveedorNombre: p.proveedorNombre,
    potenciaDeclarada: p.potenciaDeclarada,
    cantidadDisponible: p.cantidadDisponible,
    cantidadAPesar: fisicoParaActivo(activo, p.potenciaDeclarada).toString(),
  }));
}
