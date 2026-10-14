/**
 * `getPartida` (M07, FASE 5 point 5.2). Read-only, `stock.ver`. Partida
 * detail (droga, proveedor, saldo) for `/partidas/[id]` and the ajuste
 * screen, plus what preparaciones INICIADA reserved of the saldo and their
 * recetas (migration 0071, docs/specs/reserva-stock-preparacion.md): an
 * ajuste can only consume the rest.
 *
 * Expiry (docs/specs/reanalisis-partida.md, migration 0074): the original
 * date, the vencimiento vigente and its estado against the jornada, the
 * reanálisis history (newest first), and whether the session's usuario is a
 * DT vigente today -- the page offers "Registrar reanálisis" / "Marcar como
 * vencida" only to them (the commands re-check it, and so does the DB).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { NotFoundError } from "@/shared/errors";
import { estadoVencimientoPartida, type EstadoVencimientoPartida } from "../domain/vencimiento-partida";
import {
  getDiasAlertaVencimiento,
  getPartidaParaAccion,
  getReservadoEnPreparacion,
  jornadaActualTenant,
  listReanalisisDePartida,
} from "../infrastructure/partida-repository";
import type { PartidaParaAccion, ReanalisisItem } from "../infrastructure/partida-repository";
import { esDtVigenteHoy } from "../infrastructure/co-firma-repository";

export type { ReanalisisItem };

export interface PartidaDetalle extends PartidaParaAccion {
  /** Of the physical saldo, what preparaciones INICIADA reserved (unidad base). */
  cantidadReservada: string;
  /** Nº of the recetas holding that reserva. */
  recetasConReserva: string[];
  /** The tenant's jornada, YYYY-MM-DD. */
  jornadaActual: string;
  diasAlertaVencimiento: number;
  /** Of the vencimiento VIGENTE against `jornadaActual`. */
  estadoVencimiento: EstadoVencimientoPartida;
  /** Every reanálisis, newest first. */
  reanalisis: ReanalisisItem[];
  /** The session's usuario is a DT vigente (titular or suplente) today. */
  sesionEsDtVigente: boolean;
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
    const jornadaActual = await jornadaActualTenant(tx, session.tenantId);
    const diasAlertaVencimiento = await getDiasAlertaVencimiento(tx, session.tenantId);
    const vigente = partida.fechaVencimientoVigente ? partida.fechaVencimientoVigente.toISOString().slice(0, 10) : null;
    const detalle: PartidaDetalle = {
      ...partida,
      cantidadReservada: reservado.cantidad,
      recetasConReserva: reservado.recetas,
      jornadaActual,
      diasAlertaVencimiento,
      estadoVencimiento: estadoVencimientoPartida(vigente, jornadaActual, diasAlertaVencimiento),
      reanalisis: await listReanalisisDePartida(tx, session.tenantId, partida.id),
      sesionEsDtVigente: await esDtVigenteHoy(tx, session.tenantId, session.usuario.id),
    };
    return detalle;
  },
});

export async function getPartida(id: string): Promise<PartidaDetalle> {
  return getPartidaQuery.execute({ id });
}
