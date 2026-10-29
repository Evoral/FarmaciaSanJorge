/**
 * `recalcularReservaStock`: the toma workspace's "Recalcular reserva" (formerly "Modificar reserva") on an ítem whose
 * stock is reserved (openspec/specs/reserva-stock-preparacion/spec.md R1b): re-plans the reserva AUTOMATICALLY over every
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
 * `preparaciones.confirmar`, no re-authentication (same as reserving). Audited as MODIFICAR on the
 * preparación, with the old and the new reserva.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { dec } from "@/shared/decimal";
import { uuid } from "@/shared/validation";
import { evaluarFichaDeItemEnTx } from "@/modules/elaboracion/application/estado-ficha";
import {
  comoErrorDeDominio,
  lineaEntradaInput,
  pesadaAutorizadaPorIdInput,
  planificarConsumoEnTx,
  type CoFirmaPesadaInput,
  type LineaEntrada,
  type LineaEntradaInput,
} from "./confirmar-preparacion";
import { pesadasDelPlan, reservasDelPlan, resumenDelPlan } from "./reservar-stock-preparacion";
import { guardarReservaExcipienteEnTx, partidasCandidatasExcipienteEnTx, replanificarExcipienteEnTx } from "./excipiente-preparacion";
import { guardarReservaInsumosEnTx, partidasCandidatasInsumosEnTx, replanificarInsumosEnTx } from "./insumos-preparacion";
import { autorizacionDePesadaReal } from "./co-firma-pesada-real";
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
  pesadaAutorizadaPorId: pesadaAutorizadaPorIdInput,
});

export interface RecalcularReservaStockInput extends CoFirmaPesadaInput {
  preparacionId: string;
  lineas?: LineaEntradaInput[];
}

/**
 * The current reserva's entradas (enrase quantity, motivo and the partidas it draws from -- the R25 choice, applied by
 * the planner only when the línea's candidates differ in purity) per línea, overridden by what was sent.
 */
export function entradasDeReserva(reservas: readonly ReservaDePreparacion[], enviadas: readonly LineaEntrada[] = []): LineaEntrada[] {
  const porLinea = new Map<string, LineaEntrada>();
  for (const r of reservas) {
    const actual = porLinea.get(r.lineaPesajeId);
    const partidaIds = dec(r.cantidad).greaterThan(0) ? [...(actual?.partidaIds ?? []), r.partidaId] : actual?.partidaIds;
    porLinea.set(r.lineaPesajeId, {
      lineaPesajeId: r.lineaPesajeId,
      cantidadManual: actual?.cantidadManual ?? (r.cantidadManual ? dec(r.cantidadManual) : undefined),
      motivoAperturaAdicional: actual?.motivoAperturaAdicional ?? r.motivoAperturaAdicional ?? undefined,
      partidaIds,
      cantidadReal: actual?.cantidadReal ?? (r.cantidadReal ? dec(r.cantidadReal) : undefined),
    });
  }
  for (const e of enviadas) {
    const actual = porLinea.get(e.lineaPesajeId);
    porLinea.set(e.lineaPesajeId, {
      lineaPesajeId: e.lineaPesajeId,
      cantidadManual: e.cantidadManual ?? actual?.cantidadManual,
      motivoAperturaAdicional: e.motivoAperturaAdicional ?? actual?.motivoAperturaAdicional,
      partidaIds: e.partidaIds && e.partidaIds.length > 0 ? e.partidaIds : actual?.partidaIds,
      cantidadReal: e.cantidadReal ?? actual?.cantidadReal,
    });
  }
  return [...porLinea.values()];
}

/**
 * The reserva's stored DT co-firmas (openspec/specs/pesada-real/spec.md) that still hold: a línea keeps its co-firma only while
 * its pesada real is the one the DT authorized. A new pesada outside the tolerance needs a new co-firma.
 */
export function autorizacionesDeReserva(reservas: readonly ReservaDePreparacion[], entradas: readonly LineaEntrada[]): Map<string, string> {
  const autorizaciones = new Map<string, string>();
  for (const r of reservas) {
    if (!r.pesadaAutorizadaPorId || !r.cantidadReal) continue;
    const real = entradas.find((e) => e.lineaPesajeId === r.lineaPesajeId)?.cantidadReal;
    if (real && dec(real).equals(dec(r.cantidadReal))) autorizaciones.set(r.lineaPesajeId, r.pesadaAutorizadaPorId);
  }
  return autorizaciones;
}

export const recalcularReservaStockCommand = defineCommand({
  name: "preparaciones.recalcularReserva",
  permiso: "preparaciones.confirmar",
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
      const entradas = entradasDeReserva(anteriores, input.lineas);
      const plan = await planificarConsumoEnTx(tx, session.tenantId, {
        partidasAdicionales: [
          ...(await partidasCandidatasExcipienteEnTx(tx, session.tenantId, { preparacionId: input.preparacionId })),
          ...(await partidasCandidatasInsumosEnTx(tx, session.tenantId, { preparacionId: input.preparacionId })),
        ],
        preparacionId: input.preparacionId,
        fichaTecnicaId: preparacion.fichaTecnicaId,
        seleccion: { modo: "automatica", entradas, pesadaAutorizadaPorId: input.pesadaAutorizadaPorId, autorizacionesPorLinea: autorizacionesDeReserva(anteriores, entradas) },
        jornada,
      });

      // The excipiente (migration 0092) and the insumos (0110) are re-planned too, before anything is deleted.
      const excipiente = await replanificarExcipienteEnTx(tx, session, { preparacionId: input.preparacionId, jornada });
      const insumos = await replanificarInsumosEnTx(tx, session, { preparacionId: input.preparacionId, jornada });
      await deleteReservasDePreparacion(tx, session.tenantId, input.preparacionId);
      await insertReservas(tx, { tenantId: session.tenantId, preparacionId: input.preparacionId, reservadaPorId: session.usuario.id, reservas: reservasDelPlan(plan) });
      await guardarReservaExcipienteEnTx(tx, session, input.preparacionId, excipiente);
      await guardarReservaInsumosEnTx(tx, session, input.preparacionId, insumos);

      return {
        output: { id: input.preparacionId },
        audit: {
          entidadId: input.preparacionId,
          valorAnterior: {
            reservaStock: anteriores
              .filter((r) => r.cantidad !== "0")
              .map((r) => ({ lineaPesajeId: r.lineaPesajeId, partidaId: r.partidaId, cantidad: r.cantidad })),
          },
          valorNuevo: { reservaStock: resumenDelPlan(plan), ...pesadasDelPlan(plan), ...(excipiente ? { excipiente } : {}), ...(insumos.length > 0 ? { insumos } : {}) },
        },
      };
    } catch (e) {
      throw comoErrorDeDominio(e);
    }
  },
});

export async function recalcularReservaStock(input: RecalcularReservaStockInput): Promise<{ id: string }> {
  const { dtUsuarioId, dtPassword, ...resto } = input;
  const pesadaAutorizadaPorId = await autorizacionDePesadaReal({ dtUsuarioId, dtPassword });
  return recalcularReservaStockCommand.execute({ ...resto, pesadaAutorizadaPorId });
}
