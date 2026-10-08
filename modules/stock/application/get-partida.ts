/**
 * `getPartida` (M07, FASE 5 point 5.2). Read-only, `stock.ver`. Partida
 * detail (droga, proveedor, saldo) for `/stock/partidas/[id]` and the ajuste
 * screen, plus what preparaciones INICIADA reserved of the saldo and their
 * recetas (migration 0071, docs/specs/reserva-stock-preparacion.md): an
 * ajuste can only consume the rest.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { NotFoundError } from "@/shared/errors";
import { getPartidaParaAccion, getReservadoEnPreparacion } from "../infrastructure/partida-repository";
import type { PartidaParaAccion } from "../infrastructure/partida-repository";

export interface PartidaDetalle extends PartidaParaAccion {
  /** Of the physical saldo, what preparaciones INICIADA reserved (unidad base). */
  cantidadReservada: string;
  /** Nº of the recetas holding that reserva. */
  recetasConReserva: string[];
}

const getPartidaInput = z.object({ id: uuid });

export const getPartidaQuery = defineQuery({
  name: "stock.partida.ver",
  permiso: "stock.ver",
  input: getPartidaInput,
  handler: async ({ tx, session, input }) => {
    const partida = await getPartidaParaAccion(tx, session.tenantId, input.id);
    if (!partida) throw new NotFoundError("Partida no encontrada.");
    const reservado = await getReservadoEnPreparacion(tx, session.tenantId, partida.id);
    const detalle: PartidaDetalle = { ...partida, cantidadReservada: reservado.cantidad, recetasConReserva: reservado.recetas };
    return detalle;
  },
});

export async function getPartida(id: string): Promise<PartidaDetalle> {
  return getPartidaQuery.execute({ id });
}
