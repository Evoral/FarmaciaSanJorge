/**
 * `getEntregaEstado` -- backs `/entregas/[recetaId]`'s action panel. Reads
 * the receta's own delivery-relevant state (estado, receta_fisica_recibida,
 * items with `estadoAsiento`) plus its `entrega` row if one already exists
 * (ENVIO awaiting firma). The full receta/paciente/médico/ítem DISPLAY data
 * itself is fetched by the page directly from
 * `modules/recetas/application/get-receta.ts` (application-layer imports
 * across modules are allowed -- only `infrastructure/` is off limits, see
 * eslint.config.mjs) -- this query only adds what that one does not
 * already return (the `entrega` row, and `itemsEntregables`/`itemsExcluidos`
 * counts).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { calcularItemsEntregables } from "../domain/entrega";
import { getRecetaParaEntrega, getItemsParaEntrega, getEntregaPorReceta } from "../infrastructure/entrega-repository";
import type { EntregaRow } from "../infrastructure/entrega-repository";
import type { EstadoReceta } from "@/modules/recetas/domain/receta";

const getEntregaEstadoInput = z.object({ recetaId: uuid });

export interface EntregaEstado {
  recetaId: string;
  estado: EstadoReceta;
  recetaFisicaRecibida: boolean;
  itemsEntregables: number;
  itemsExcluidos: number;
  entrega: EntregaRow | null;
}

export const getEntregaEstadoQuery = defineQuery({
  name: "entregas.estado.ver",
  permiso: "entregas.registrar",
  input: getEntregaEstadoInput,
  handler: async ({ tx, session, input }): Promise<EntregaEstado> => {
    const receta = await getRecetaParaEntrega(tx, session.tenantId, input.recetaId);
    if (!receta) throw new NotFoundError("Receta no encontrada.");

    const [items, entrega] = await Promise.all([
      getItemsParaEntrega(tx, session.tenantId, input.recetaId),
      getEntregaPorReceta(tx, session.tenantId, input.recetaId),
    ]);
    const { entregables, excluidos } = calcularItemsEntregables(items);

    return {
      recetaId: receta.id,
      estado: receta.estado,
      recetaFisicaRecibida: receta.recetaFisicaRecibida,
      itemsEntregables: entregables.length,
      itemsExcluidos: excluidos.length,
      entrega,
    };
  },
});

export async function getEntregaEstado(input: { recetaId: string }): Promise<EntregaEstado> {
  return getEntregaEstadoQuery.execute(input);
}
