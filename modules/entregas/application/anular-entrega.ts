/**
 * `anularEntrega` -- docs/specs/anular-entrega.md. The mostrador reverts an entrega registered by mistake (another
 * receta was picked): the receta goes back from ENTREGADA / ENVIADA_PEND_FIRMA to PREPARADA and reappears in
 * /entregas. Same permiso as registering it (`entregas.registrar`, PIN-configurable for cuentas de sector: the
 * Server Action wraps it in `conOperador`); a motivo is required. Lock BEFORE the fresh read (M3).
 *
 * Write order inside the transaction (migration 0086):
 *   1. copy the entrega to `fsj.entrega_anulada` and delete it (INV-ENT-004 needs the copy first);
 *   2. receta estado -> PREPARADA (INV-R08 only allows it once the entrega row is gone and the receta is not archived);
 *   3. optionally clear the payment (`marcarImpaga`), AFTER the estado UPDATE: INV-R14 refuses lowering it while ENTREGADA.
 *
 * Touches neither the libro (the asiento records the preparación, not the entrega), nor stock.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
import { DomainError, InvariantViolationError, NotFoundError, mapDbError } from "@/shared/errors";
import { mensajeGlobalParaInvariante } from "@/shared/errors/mensajes-invariantes";
import { nonEmptyString, uuid } from "@/shared/validation";
import { MENSAJE_ANULAR_ENTREGA_ARCHIVADA, puedeAnularEntrega, validarAnularEntrega } from "../domain/entrega";
import {
  actualizarEstadoReceta,
  desmarcarRecetaPagada,
  getItemsParaEntrega,
  getRecetaParaEntrega,
  lockRecetaParaAccion,
  moverEntregaAAnuladas,
  recetaEstaArchivada,
} from "../infrastructure/entrega-repository";

const anularEntregaInput = z.object({
  recetaId: uuid,
  motivo: nonEmptyString,
  /** The receta was also marked paid by mistake: leave it unpaid (only lowers the flag, never raises it). */
  marcarImpaga: z.boolean().default(false),
});

/** Pre-default wire shape: `marcarImpaga` may be omitted (= false). */
export type AnularEntregaInput = z.input<typeof anularEntregaInput>;

function mensajeParaInvariante(codigo: string): string {
  if (codigo === "INV-R08") return MENSAJE_ANULAR_ENTREGA_ARCHIVADA;
  return mensajeGlobalParaInvariante(codigo) ?? "No se pudo anular la entrega.";
}

export const anularEntregaCommand = defineCommand({
  name: "entregas.anular",
  permiso: "entregas.registrar",
  input: anularEntregaInput,
  audit: { entidad: "entrega", accion: TipoAccion.ANULAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.recetaId);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const receta = await getRecetaParaEntrega(tx, session.tenantId, input.recetaId);
    if (!receta) throw new NotFoundError("Receta no encontrada.");
    if (!puedeAnularEntrega(receta.estado)) {
      throw new DomainError("La receta no tiene una entrega registrada para anular.");
    }

    validarAnularEntrega({
      archivada: await recetaEstaArchivada(tx, session.tenantId, input.recetaId),
      items: await getItemsParaEntrega(tx, session.tenantId, input.recetaId),
    });

    try {
      const entrega = await moverEntregaAAnuladas(tx, {
        tenantId: session.tenantId,
        recetaId: input.recetaId,
        motivo: input.motivo,
        anuladaPorId: session.usuario.id,
      });
      if (!entrega) throw new DomainError("La receta no tiene una entrega registrada para anular.");

      await actualizarEstadoReceta(tx, session.tenantId, input.recetaId, "PREPARADA");

      const desmarcarPago = input.marcarImpaga && receta.pagada;
      if (desmarcarPago) {
        await desmarcarRecetaPagada(tx, session.tenantId, input.recetaId);
        await auditRecord(tx, {
          tenantId: session.tenantId,
          usuarioId: session.usuario.id,
          entidad: "receta",
          entidadId: input.recetaId,
          accion: TipoAccion.MODIFICAR,
          valorAnterior: { pagada: true },
          valorNuevo: { pagada: false },
          contexto: { origen: "anular-entrega" },
        });
      }

      return {
        output: { recetaId: input.recetaId },
        audit: {
          entidadId: entrega.entregaId,
          motivo: input.motivo,
          valorAnterior: { estadoReceta: receta.estado, modalidad: entrega.modalidad, pagada: receta.pagada },
          valorNuevo: { estadoReceta: "PREPARADA", pagada: receta.pagada && !desmarcarPago },
        },
      };
    } catch (e) {
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError(mensajeParaInvariante(mapped.invariantCode), { cause: mapped });
      }
      throw mapped;
    }
  },
});

export async function anularEntrega(input: AnularEntregaInput): Promise<{ recetaId: string }> {
  return anularEntregaCommand.execute(input);
}
