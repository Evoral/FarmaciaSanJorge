/**
 * `liberarReservaStock`: the toma workspace's "Liberar reserva" on an ítem
 * whose stock is reserved (migration 0071,
 * docs/specs/reserva-stock-preparacion.md). Deletes the preparación's
 * reservas and discards it (DESCARTADA, the same write as
 * `descartarPreparacion`: no stock movement, receta estado untouched),
 * in ONE transaction, so the ítem is Pendiente again and can be reserved
 * from scratch. A receta with no confirmed ítem is still
 * PENDIENTE_PREPARACION, so it is editable again (migration 0072). Only an INICIADA preparación that holds a reserva: one
 * without (from before 0071 or the ficha técnica screen's "Preparar") is
 * discarded from its own screen, with a motivo.
 *
 * `preparaciones.descartar` + recent re-authentication (INV-X02, same window
 * as the confirmation). Audited as DESCARTAR, with a fixed motivo and the
 * released reserva.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { descartarPreparacionEnTx } from "./descartar-preparacion";
import { listReservasDePreparacion, lockPreparacionParaAccion } from "../infrastructure/preparacion-repository";

/** `preparacion.motivo_descarte` of a released reserva. */
export const MOTIVO_LIBERAR_RESERVA = "Reserva de stock liberada.";

const liberarReservaStockInput = z.object({ preparacionId: uuid });

export const liberarReservaStockCommand = defineCommand({
  name: "preparaciones.liberarReserva",
  permiso: "preparaciones.descartar",
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: liberarReservaStockInput,
  audit: { entidad: "preparacion", accion: TipoAccion.DESCARTAR },
  handler: async ({ tx, session, input }) => {
    // Read the reserva under the preparación's lock (descartarPreparacionEnTx re-locks it, same transaction).
    if (!(await lockPreparacionParaAccion(tx, session.tenantId, input.preparacionId))) {
      throw new NotFoundError("Preparación no encontrada.");
    }
    const reservas = await listReservasDePreparacion(tx, session.tenantId, input.preparacionId);
    if (reservas.length === 0) {
      throw new DomainError("Esta preparación no tiene stock reservado.");
    }

    await descartarPreparacionEnTx(tx, session, input.preparacionId, MOTIVO_LIBERAR_RESERVA);

    return {
      output: { id: input.preparacionId },
      audit: {
        entidadId: input.preparacionId,
        motivo: MOTIVO_LIBERAR_RESERVA,
        valorNuevo: {
          estado: "DESCARTADA",
          reservaStockLiberada: reservas
            .filter((r) => r.cantidad !== "0")
            .map((r) => ({ lineaPesajeId: r.lineaPesajeId, partidaId: r.partidaId, cantidad: r.cantidad })),
        },
      },
    };
  },
});

export async function liberarReservaStock(preparacionId: string): Promise<{ id: string }> {
  return liberarReservaStockCommand.execute({ preparacionId });
}
