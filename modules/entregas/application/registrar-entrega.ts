/**
 * `registrarEntrega` -- FASE 11 points 11.1/11.2 (M14). Valid from PREPARADA
 * only: the receta goes PREPARADA -> (ENTREGADA | ENVIADA_PEND_FIRMA) in a
 * single receta.estado UPDATE (LISTA_PARA_RETIRAR was removed, migration
 * 0061; the state machine trigger, migration 0011/0061, validates it). Lock
 * BEFORE the fresh read (M3 discipline, same as every other
 * recetas-adjacent command).
 *
 * Write order inside the transaction (INV-ENT-002, migration 0040, needs the
 * entrega row first): INSERT entrega -> receta: PREPARADA -> (ENTREGADA |
 * ENVIADA_PEND_FIRMA). No receta física step: the attribute and INV-R07 were
 * removed (client decision 2026-10-01, migration 0051).
 *
 * Payment (migration 0071, docs/specs/pago-receta.md): the entrega may also mark the receta paid, in the same
 * transaction (`pagada` input, raise-only). An UNPAID receta can be delivered -- it is never blocked, the screen
 * only flags it.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
import { DomainError, InvariantViolationError, NotFoundError, mapDbError } from "@/shared/errors";
import { mensajeGlobalParaInvariante } from "@/shared/errors/mensajes-invariantes";
import { uuid } from "@/shared/validation";
import { MODALIDADES_ENTREGA, puedeRegistrarEntrega, estadoDestinoEntrega, validarTieneItemsEntregables } from "../domain/entrega";
import {
  lockRecetaParaAccion,
  getRecetaParaEntrega,
  getItemsParaEntrega,
  actualizarEstadoReceta,
  insertEntrega,
  marcarRecetaPagada,
} from "../infrastructure/entrega-repository";

const registrarEntregaInput = z.object({
  recetaId: uuid,
  modalidad: z.enum(MODALIDADES_ENTREGA),
  /**
   * Migration 0071: `true` marks the receta paid in this same transaction (who and when are set by the server). It
   * only ever RAISES the flag -- `false`, or `true` on a receta that is already paid, leaves the payment untouched
   * (an already-paid receta keeps its original `pagadaEn`/`pagadaPorId`); unmarking is done from the receta's detail.
   */
  pagada: z.boolean().default(false),
});

/** Pre-default wire shape: `pagada` may be omitted (= false). */
export type RegistrarEntregaInput = z.input<typeof registrarEntregaInput>;

/** Human-readable message for the M14 invariant that can still slip past the pre-checks below under a race (INV-ENT-002) -- mirrors `modules/cierres/application/firmar-cierre.ts`'s `mapDbError`-in-its-own-try/catch discipline (the pipeline's own mapping, in `withTenantTransaction`, only runs once the WHOLE handler throws, too late for a clear message here). */
function mensajeParaInvariante(codigo: string): string {
  if (codigo === "INV-ENT-002") return "No se pudo registrar la entrega: falta el registro de entrega correspondiente.";
  return mensajeGlobalParaInvariante(codigo) ?? "No se pudo registrar la entrega.";
}

export const registrarEntregaCommand = defineCommand({
  name: "entregas.registrar",
  permiso: "entregas.registrar",
  input: registrarEntregaInput,
  audit: { entidad: "entrega", accion: TipoAccion.CAMBIAR_ESTADO },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.recetaId);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const receta = await getRecetaParaEntrega(tx, session.tenantId, input.recetaId);
    if (!receta) throw new NotFoundError("Receta no encontrada.");

    if (!puedeRegistrarEntrega(receta.estado)) {
      throw new DomainError(`La receta está en estado ${receta.estado}: no admite registrar una entrega.`);
    }

    const items = await getItemsParaEntrega(tx, session.tenantId, input.recetaId);
    validarTieneItemsEntregables(items);

    try {
      const entrega = await insertEntrega(tx, {
        tenantId: session.tenantId,
        recetaId: input.recetaId,
        modalidad: input.modalidad,
        entregadaPorId: session.usuario.id,
      });

      const estadoDestino = estadoDestinoEntrega(input.modalidad);
      await actualizarEstadoReceta(tx, session.tenantId, input.recetaId, estadoDestino);

      // Delivering an unpaid receta is allowed; the checkbox can only record the payment now. The payment is audited on
      // the entrega row (before/after, below) and ALSO on the receta's own history.
      const marcarPago = input.pagada && !receta.pagada;
      if (marcarPago) {
        await marcarRecetaPagada(tx, session.tenantId, input.recetaId, session.usuario.id);
        await auditRecord(tx, {
          tenantId: session.tenantId,
          usuarioId: session.usuario.id,
          entidad: "receta",
          entidadId: input.recetaId,
          accion: TipoAccion.MODIFICAR,
          valorAnterior: { pagada: false },
          valorNuevo: { pagada: true },
          contexto: { origen: "entrega" },
        });
      }

      return {
        output: { id: entrega.id, recetaId: input.recetaId, estado: estadoDestino },
        audit: {
          entidadId: entrega.id,
          valorAnterior: { estadoReceta: receta.estado, pagada: receta.pagada },
          valorNuevo: { modalidad: input.modalidad, estadoReceta: estadoDestino, pagada: receta.pagada || marcarPago },
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

export async function registrarEntrega(input: RegistrarEntregaInput): Promise<{ id: string; recetaId: string; estado: string }> {
  return registrarEntregaCommand.execute(input);
}
