/**
 * `getPartida` (M07, FASE 5 point 5.2). Read-only, `stock.ver`. Partida
 * detail (droga, proveedor, saldo) for `/stock/partidas/[id]`.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { NotFoundError } from "@/shared/errors";
import { getPartidaParaAccion } from "../infrastructure/partida-repository";
import type { PartidaParaAccion } from "../infrastructure/partida-repository";

const getPartidaInput = z.object({ id: uuid });

export const getPartidaQuery = defineQuery({
  name: "stock.partida.ver",
  permiso: "stock.ver",
  input: getPartidaInput,
  handler: async ({ tx, session, input }) => {
    const partida = await getPartidaParaAccion(tx, session.tenantId, input.id);
    if (!partida) throw new NotFoundError("Partida no encontrada.");
    return partida;
  },
});

export async function getPartida(id: string): Promise<PartidaParaAccion> {
  return getPartidaQuery.execute({ id });
}
