/**
 * `recalcularReservaStock`: the toma workspace's "Recalcular reserva" (formerly "Modificar reserva") on an ítem whose
 * stock is reserved (docs/specs/reserva-stock-preparacion.md R1b): re-plans the reserva AUTOMATICALLY over every
 * eligible partida (R1: abiertas first, then FEFO) and REPLACES the preparación's reservas, in ONE transaction. Same
 * preparación (still INICIADA), nothing discarded, no stock movement, no asiento. One click from the ítem (e.g. when
 * "Imprimir etiquetas" would fail because an ajuste or an expired partida broke the reserva, R5) or from the dialog,
 * where the enrase manual quantity (and, if INV-S18 asks for it, the motivo) can be changed; what is not sent keeps
 * the current reserva's value.
 *
 * The preparación's OWN current reservas count as available to it (they are the ones being replaced), other
 * preparaciones' do not. Its ficha must still be vigente (R18: the ítem's latest version, built from the ítem's
 * current data) -- a reserva is never re-made on an out-of-date ficha: release it and start again. Nothing can make
 * the ficha stale while the preparación lives (editing the receta and generating a new version are refused), except a
 * weighing parameter change or data from before those rules.
 *
 * Locks (R23): the preparación first (so a concurrent "Liberar reserva"/"Imprimir etiquetas" on it waits), then every
 * candidate partida in id order (inside `planificarConsumoEnTx`).
 *
 * `preparaciones.confirmar` + recent re-authentication (INV-X02), same as reserving. Audited as MODIFICAR on the
 * preparación, with the old and the new reserva.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { DomainError, NotFoundError } from "@/shared/errors";
import { dec } from "@/shared/decimal";
import { uuid } from "@/shared/validation";
import { evaluarFichaDeItemEnTx } from "@/modules/elaboracion/application/estado-ficha";
import { comoErrorDeDominio, lineaEntradaInput, planificarConsumoEnTx, type LineaEntrada, type LineaEntradaInput } from "./confirmar-preparacion";
import { reservasDelPlan, resumenDelPlan } from "./reservar-stock-preparacion";
import {
  deleteReservasDePreparacion,
  getPreparacionParaAccion,
  insertReservas,
  jornadaActualTenant,
  listReservasDePreparacion,
  lockPreparacionParaAccion,
  type ReservaDePreparacion,
} from "../infrastructure/preparacion-repository";

const recalcularReservaStockInput = z.object({
  preparacionId: uuid,
  /** Only what changes; a línea not sent keeps the current reserva's enrase quantity and motivo. */
  lineas: z.array(lineaEntradaInput).default([]),
});

export interface RecalcularReservaStockInput {
  preparacionId: string;
  lineas?: LineaEntradaInput[];
}

/** The current reserva's entradas (enrase quantity, motivo) per línea, overridden by what was sent. */
export function entradasDeReserva(reservas: readonly ReservaDePreparacion[], enviadas: readonly LineaEntrada[] = []): LineaEntrada[] {
  const porLinea = new Map<string, LineaEntrada>();
  for (const r of reservas) {
    if (porLinea.has(r.lineaPesajeId) || (r.cantidadManual === null && r.motivoAperturaAdicional === null)) continue;
    porLinea.set(r.lineaPesajeId, {
      lineaPesajeId: r.lineaPesajeId,
      cantidadManual: r.cantidadManual ? dec(r.cantidadManual) : undefined,
      motivoAperturaAdicional: r.motivoAperturaAdicional ?? undefined,
    });
  }
  for (const e of enviadas) {
    const actual = porLinea.get(e.lineaPesajeId);
    porLinea.set(e.lineaPesajeId, {
      lineaPesajeId: e.lineaPesajeId,
      cantidadManual: e.cantidadManual ?? actual?.cantidadManual,
      motivoAperturaAdicional: e.motivoAperturaAdicional ?? actual?.motivoAperturaAdicional,
    });
  }
  return [...porLinea.values()];
}

export const recalcularReservaStockCommand = defineCommand({
  name: "preparaciones.recalcularReserva",
  permiso: "preparaciones.confirmar",
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: recalcularReservaStockInput,
  audit: { entidad: "preparacion", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    try {
      if (!(await lockPreparacionParaAccion(tx, session.tenantId, input.preparacionId))) {
        throw new NotFoundError("Preparación no encontrada.");
      }
      const preparacion = await getPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
      if (!preparacion) throw new NotFoundError("Preparación no encontrada.");
      if (preparacion.estado !== "INICIADA") {
        throw new DomainError(`Esta preparación ya no está INICIADA (estado actual: ${preparacion.estado}): su reserva no se puede recalcular.`);
      }
      const anteriores = await listReservasDePreparacion(tx, session.tenantId, input.preparacionId);
      if (anteriores.length === 0) {
        throw new DomainError("Esta preparación no tiene stock reservado.");
      }

      const ficha = await evaluarFichaDeItemEnTx(tx, session.tenantId, preparacion.itemRecetaId, preparacion.fichaTecnicaId);
      if (!ficha.vigente) {
        throw new DomainError(
          "La ficha técnica de esta reserva ya no está vigente: liberá la reserva, generá la ficha técnica de nuevo y volvé a marcar el ítem como preparado.",
        );
      }

      const jornada = await jornadaActualTenant(tx, session.tenantId);
      const plan = await planificarConsumoEnTx(tx, session.tenantId, {
        preparacionId: input.preparacionId,
        fichaTecnicaId: preparacion.fichaTecnicaId,
        seleccion: { modo: "automatica", entradas: entradasDeReserva(anteriores, input.lineas) },
        jornada,
      });

      await deleteReservasDePreparacion(tx, session.tenantId, input.preparacionId);
      await insertReservas(tx, { tenantId: session.tenantId, preparacionId: input.preparacionId, reservadaPorId: session.usuario.id, reservas: reservasDelPlan(plan) });

      return {
        output: { id: input.preparacionId },
        audit: {
          entidadId: input.preparacionId,
          valorAnterior: {
            reservaStock: anteriores
              .filter((r) => r.cantidad !== "0")
              .map((r) => ({ lineaPesajeId: r.lineaPesajeId, partidaId: r.partidaId, cantidad: r.cantidad })),
          },
          valorNuevo: { reservaStock: resumenDelPlan(plan) },
        },
      };
    } catch (e) {
      throw comoErrorDeDominio(e);
    }
  },
});

export async function recalcularReservaStock(input: RecalcularReservaStockInput): Promise<{ id: string }> {
  return recalcularReservaStockCommand.execute(input);
}
