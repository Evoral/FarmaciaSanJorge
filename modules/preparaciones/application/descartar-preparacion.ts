/**
 * `descartarPreparacion` (M11, FASE 8 point 8.1). FAR/DT (plan §7:
 * `preparaciones.descartar`). Only a INICIADA preparación can be discarded
 * (INV-P05 -- DB trigger, migration 0013, is the real backstop). Discarding
 * touches NO stock (task scope) -- it is the ONLY confirmation-adjacent
 * write that never opens `fsj.movimiento_stock`; a reserva de stock it held
 * (migration 0071) is released in the same transaction. The receta's
 * estado never changes here (INV-R08: no backwards transitions): a receta
 * that had no confirmation yet is still PENDIENTE_PREPARACION (starting a
 * preparación no longer moves it) and becomes editable again, since a
 * DESCARTADA preparación does not block editing (migration 0072); one
 * already EN_PREPARACION stays so ("descarte de una preparación INICIADA
 * con otras aún pendientes ⇒ la receta permanece EN_PREPARACION", plan §9
 * M09).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import {
  lockPreparacionParaAccion,
  getPreparacionParaAccion,
  updatePreparacionDescartada,
  deleteReservasDePreparacion,
} from "../infrastructure/preparacion-repository";

const descartarPreparacionInput = z.object({ preparacionId: uuid, motivo: nonEmptyString });

export interface DescartarPreparacionInput {
  preparacionId: string;
  motivo: string;
}

export const descartarPreparacionCommand = defineCommand({
  name: "preparaciones.descartar",
  permiso: "preparaciones.descartar",
  input: descartarPreparacionInput,
  audit: { entidad: "preparacion", accion: TipoAccion.DESCARTAR },
  handler: async ({ tx, session, input }) => {
    const { reservasLiberadas } = await descartarPreparacionEnTx(tx, session, input.preparacionId, input.motivo);

    return {
      output: { id: input.preparacionId },
      audit: {
        entidadId: input.preparacionId,
        motivo: input.motivo,
        valorNuevo: { estado: "DESCARTADA", ...(reservasLiberadas > 0 ? { reservaStockLiberada: true } : {}) },
      },
    };
  },
});

/**
 * The discard itself (lock, INICIADA check, release of its reserva de stock,
 * DESCARTADA), inside the caller's transaction: also run by
 * `liberarReservaStock` (./liberar-reserva-stock.ts). The caller declares
 * the permiso and the audit. `reservasLiberadas` = reserva rows deleted.
 */
export async function descartarPreparacionEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  preparacionId: string,
  motivo: string,
): Promise<{ reservasLiberadas: number }> {
  const locked = await lockPreparacionParaAccion(tx, session.tenantId, preparacionId);
  if (!locked) throw new NotFoundError("Preparación no encontrada.");

  const preparacion = await getPreparacionParaAccion(tx, session.tenantId, preparacionId);
  if (!preparacion) throw new NotFoundError("Preparación no encontrada.");

  if (preparacion.estado !== "INICIADA") {
    throw new DomainError(`Solo se puede descartar una preparación INICIADA (estado actual: ${preparacion.estado}).`);
  }

  const reservasLiberadas = await deleteReservasDePreparacion(tx, session.tenantId, preparacionId);
  await updatePreparacionDescartada(tx, session.tenantId, preparacionId, {
    motivoDescarte: motivo,
    descartadaPorId: session.usuario.id,
  });
  return { reservasLiberadas };
}

export async function descartarPreparacion(input: DescartarPreparacionInput): Promise<{ id: string }> {
  return descartarPreparacionCommand.execute(input);
}
