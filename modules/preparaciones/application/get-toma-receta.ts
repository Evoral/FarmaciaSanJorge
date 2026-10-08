/**
 * `getTomaReceta` (M11): everything the toma workspace
 * (/preparaciones/recetas/[recetaId]) shows -- the receta (header, toma,
 * ítems with componentes), each ítem's latest ficha técnica with its líneas
 * de pesaje, and each ítem's INICIADA/CONFIRMADA preparación. `null` when
 * the receta does not exist (in this tenant).
 *
 * Purity per partida (migration 0058): every non-manual línea of an ítem
 * still to be reserved (no preparación, or an INICIADA one without reservas)
 * also lists the partidas the confirmation would draw from, with the
 * PHYSICAL weight each one needs (./partidas-para-pesar.ts, shared with the
 * draft preview `preparaciones.toma.previsualizarFichas`). An ítem with stock
 * reserved lists its reservas instead (migration 0071).
 *
 * `preparaciones.iniciar`, like every /preparaciones read. The embedded
 * receta edit form reads its own data through `recetas.ver` (recetas
 * module), gated on the recetas permisos by the page.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { getRecetaDeToma } from "../infrastructure/preparacion-repository";
import type {
  FichaDeItemToma as FichaDeItemTomaBase,
  ItemDeToma as ItemDeTomaBase,
  LineaDeFichaToma as LineaDeFichaTomaBase,
  RecetaDeToma as RecetaDeTomaBase,
} from "../infrastructure/preparacion-repository";
import { cargarPartidasPorDroga, esLineaPesable, partidasDeLinea } from "./partidas-para-pesar";
import type { PartidaParaPesar } from "./partidas-para-pesar";

export type { PartidaParaPesar };

export interface LineaDeFichaToma extends LineaDeFichaTomaBase {
  /** `null` for manual-enrase líneas, líneas without cantidadAPesar, and ítems already CONFIRMADA or with stock reserved. */
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

    // A CONFIRMADA ítem already drew its partidas, a reserved one already chose them: nothing left to weigh from.
    const porElegir = (item: ItemDeTomaBase) => item.preparacion?.estado !== "CONFIRMADA" && (item.preparacion?.reservas.length ?? 0) === 0;
    const lineasPorPesar = (item: ItemDeTomaBase) => (porElegir(item) ? (item.ultimaFicha?.lineas ?? []) : []);
    const partidasPorDroga = await cargarPartidasPorDroga(
      tx,
      session.tenantId,
      receta.items.flatMap((item) => lineasPorPesar(item).filter(esLineaPesable).map((l) => l.drogaId)),
    );

    return {
      ...receta,
      items: receta.items.map((item) => ({
        ...item,
        ultimaFicha: item.ultimaFicha
          ? {
              ...item.ultimaFicha,
              lineas: item.ultimaFicha.lineas.map((linea) => ({
                ...linea,
                partidas: porElegir(item) ? partidasDeLinea(partidasPorDroga, linea) : null,
              })),
            }
          : null,
      })),
    };
  },
});

export async function getTomaReceta(recetaId: string): Promise<RecetaDeToma | null> {
  return getTomaRecetaQuery.execute({ recetaId });
}
