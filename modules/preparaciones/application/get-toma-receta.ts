/**
 * `getTomaReceta` (M11): everything the toma workspace
 * (/preparaciones/recetas/[recetaId]) shows -- the receta (header, toma,
 * ítems with componentes), each ítem's latest ficha técnica with its líneas
 * de pesaje, and each ítem's INICIADA/CONFIRMADA preparación. `null` when
 * the receta does not exist (in this tenant).
 *
 * Purity per partida (migration 0058): every non-manual línea of an ítem not
 * yet CONFIRMADA also lists the partidas the confirmation would draw from
 * (`listPartidasElegiblesDroga` + `ordenarParaConsumo`: same candidates,
 * same order, vencidas and empty ones left out) with the PHYSICAL weight
 * each one needs for the línea's `cantidadAPesar` (= active required):
 * `fisicoParaActivo`, domain/potencia.ts -- the same function the
 * confirmation uses.
 *
 * `preparaciones.iniciar`, like every /preparaciones read. The embedded
 * receta edit form reads its own data through `recetas.ver` (recetas
 * module), gated on the recetas permisos by the page.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { ordenarParaConsumo } from "@/modules/stock/domain/reparto";
import { fisicoParaActivo } from "../domain/potencia";
import { getRecetaDeToma, jornadaActualTenant, listPartidasElegiblesDroga } from "../infrastructure/preparacion-repository";
import type {
  FichaDeItemToma as FichaDeItemTomaBase,
  ItemDeToma as ItemDeTomaBase,
  LineaDeFichaToma as LineaDeFichaTomaBase,
  PartidaElegible,
  RecetaDeToma as RecetaDeTomaBase,
} from "../infrastructure/preparacion-repository";

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

export interface LineaDeFichaToma extends LineaDeFichaTomaBase {
  /** `null` for manual-enrase líneas, líneas without cantidadAPesar, and ítems already CONFIRMADA. */
  partidas: PartidaParaPesar[] | null;
}

export interface FichaDeItemToma extends Omit<FichaDeItemTomaBase, "lineas"> {
  lineas: LineaDeFichaToma[];
}

export interface ItemDeToma extends Omit<ItemDeTomaBase, "ultimaFicha"> {
  ultimaFicha: FichaDeItemToma | null;
}

export interface RecetaDeToma extends Omit<RecetaDeTomaBase, "items"> {
  items: ItemDeToma[];
}

const getTomaRecetaInput = z.object({ recetaId: uuid });

export const getTomaRecetaQuery = defineQuery({
  name: "preparaciones.toma.ver",
  permiso: "preparaciones.iniciar",
  input: getTomaRecetaInput,
  handler: async ({ tx, session, input }): Promise<RecetaDeToma | null> => {
    const receta = await getRecetaDeToma(tx, session.tenantId, input.recetaId);
    if (!receta) return null;

    const necesitaPartidas = (item: ItemDeTomaBase, linea: LineaDeFichaTomaBase) =>
      item.preparacion?.estado !== "CONFIRMADA" && !linea.esEnraseManual && linea.cantidadAPesar !== null;

    const drogaIds = new Set(receta.items.flatMap((item) => (item.ultimaFicha?.lineas ?? []).filter((l) => necesitaPartidas(item, l)).map((l) => l.drogaId)));
    const partidasPorDroga = new Map<string, PartidaElegible[]>();
    if (drogaIds.size > 0) {
      const jornada = await jornadaActualTenant(tx, session.tenantId);
      for (const drogaId of drogaIds) {
        partidasPorDroga.set(drogaId, ordenarParaConsumo(await listPartidasElegiblesDroga(tx, session.tenantId, drogaId), jornada));
      }
    }

    return {
      ...receta,
      items: receta.items.map((item) => ({
        ...item,
        ultimaFicha: item.ultimaFicha
          ? {
              ...item.ultimaFicha,
              lineas: item.ultimaFicha.lineas.map((linea) => {
                const activo = linea.cantidadAPesar;
                return {
                  ...linea,
                  partidas:
                    necesitaPartidas(item, linea) && activo !== null
                      ? (partidasPorDroga.get(linea.drogaId) ?? []).map((p) => ({
                          id: p.id,
                          lote: p.lote,
                          proveedorNombre: p.proveedorNombre,
                          potenciaDeclarada: p.potenciaDeclarada,
                          cantidadDisponible: p.cantidadDisponible,
                          cantidadAPesar: fisicoParaActivo(activo, p.potenciaDeclarada).toString(),
                        }))
                      : null,
                };
              }),
            }
          : null,
      })),
    };
  },
});

export async function getTomaReceta(recetaId: string): Promise<RecetaDeToma | null> {
  return getTomaRecetaQuery.execute({ recetaId });
}
