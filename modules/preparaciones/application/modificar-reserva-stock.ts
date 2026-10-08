/**
 * `modificarReservaStock`: the toma workspace's "Modificar reserva" on an
 * ítem whose stock is reserved (docs/specs/reserva-stock-preparacion.md):
 * REPLACES the preparación's reservas with a new choice (partidas per línea,
 * enrase manual quantity, INV-S18 motivo), in ONE transaction. Same
 * preparación (still INICIADA), nothing discarded, no stock movement, no
 * asiento.
 *
 * The new choice is validated exactly like a reserva and its confirmation
 * (`planificarConsumoEnTx`, ./confirmar-preparacion.ts); the preparación's
 * OWN current reservas count as available to it (they are the ones being
 * replaced), other preparaciones' do not. Locks: the preparación first (so a
 * concurrent "Liberar reserva"/"Imprimir etiqueta" on it waits), then the
 * chosen partidas in id order (inside `planificarConsumoEnTx`).
 *
 * `preparaciones.confirmar` + recent re-authentication (INV-X02), same as
 * reserving. Audited as MODIFICAR on the preparación, with the old and the
 * new reserva.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { comoErrorDeDominio, lineaConfirmacionInput, planificarConsumoEnTx, type ConfirmarPreparacionLineaInput } from "./confirmar-preparacion";
import { reservasDelPlan, resumenDelPlan } from "./reservar-stock-preparacion";
import {
  deleteReservasDePreparacion,
  getPreparacionParaAccion,
  insertReservas,
  jornadaActualTenant,
  listReservasDePreparacion,
  lockPreparacionParaAccion,
} from "../infrastructure/preparacion-repository";

const modificarReservaStockInput = z.object({
  preparacionId: uuid,
  lineas: z.array(lineaConfirmacionInput).min(1),
});

export interface ModificarReservaStockInput {
  preparacionId: string;
  lineas: ConfirmarPreparacionLineaInput[];
}

export const modificarReservaStockCommand = defineCommand({
  name: "preparaciones.modificarReserva",
  permiso: "preparaciones.confirmar",
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: modificarReservaStockInput,
  audit: { entidad: "preparacion", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    try {
      if (!(await lockPreparacionParaAccion(tx, session.tenantId, input.preparacionId))) {
        throw new NotFoundError("Preparación no encontrada.");
      }
      const preparacion = await getPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
      if (!preparacion) throw new NotFoundError("Preparación no encontrada.");
      if (preparacion.estado !== "INICIADA") {
        throw new DomainError(`Esta preparación ya no está INICIADA (estado actual: ${preparacion.estado}): su reserva no se puede modificar.`);
      }
      const anteriores = await listReservasDePreparacion(tx, session.tenantId, input.preparacionId);
      if (anteriores.length === 0) {
        throw new DomainError("Esta preparación no tiene stock reservado.");
      }

      const jornada = await jornadaActualTenant(tx, session.tenantId);
      const plan = await planificarConsumoEnTx(tx, session.tenantId, {
        preparacionId: input.preparacionId,
        fichaTecnicaId: preparacion.fichaTecnicaId,
        lineas: input.lineas,
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

export async function modificarReservaStock(input: ModificarReservaStockInput): Promise<{ id: string }> {
  return modificarReservaStockCommand.execute(input);
}
