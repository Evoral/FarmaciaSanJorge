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
 * Payment (docs/specs/pago-receta.md P3/P4): the entrega may also mark the receta paid, in the same transaction
 * (`pagada` input, raise-only). A RETIRO_PRESENCIAL must leave the receta paid (it becomes ENTREGADA right away); an
 * ENVIO may stay unpaid until its firma is confirmed (confirmar-firma-recibida.ts). The payment is written BEFORE the
 * estado UPDATE: INV-R14 (migration 0076) rejects a receta becoming ENTREGADA unpaid.
 *
 * Repartidor (docs/specs/envios-repartidores.md E1-E4): an ENVIO carries exactly one active repartidor of the tenant
 * (`repartidorId`, required by the input schema; DB backstop INV-ENT-005) and needs a receta with a domicilio; a
 * RETIRO_PRESENCIAL carries none. Both reads happen inside the transaction, after the receta lock. A receta without
 * domicilio cannot be edited from PREPARADA, so the envío form asks for it (`domicilio`) and this command saves it on the
 * receta (only that column, audited as MODIFICAR) before inserting the entrega; a `domicilio` sent for a receta that
 * already has one is rejected (the receta's value is never overwritten from here).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
import { DomainError, InvariantViolationError, NotFoundError, mapDbError } from "@/shared/errors";
import { mensajeGlobalParaInvariante } from "@/shared/errors/mensajes-invariantes";
import { uuid } from "@/shared/validation";
import { domicilioPacienteOpcional } from "@/modules/recetas/domain/receta";
import {
  MODALIDADES_ENTREGA,
  MENSAJE_ENTREGA_REQUIERE_PAGO,
  puedeRegistrarEntrega,
  estadoDestinoEntrega,
  validarTieneItemsEntregables,
  entregaExigePago,
  validarPagoAlEntregar,
  mensajeRepartidorSegunModalidad,
  resolverDomicilioParaEnvio,
  MENSAJE_RETIRO_CON_DOMICILIO,
  validarRepartidorAsignable,
} from "../domain/entrega";
import {
  lockRecetaParaAccion,
  getRecetaParaEntrega,
  getItemsParaEntrega,
  actualizarEstadoReceta,
  insertEntrega,
  marcarRecetaPagada,
  actualizarDomicilioReceta,
  getRepartidorParaAsignar,
} from "../infrastructure/entrega-repository";

const registrarEntregaInput = z
  .object({
    recetaId: uuid,
    modalidad: z.enum(MODALIDADES_ENTREGA),
    /**
     * Migration 0071: `true` marks the receta paid in this same transaction (who and when are set by the server). It
     * only ever RAISES the flag -- `false`, or `true` on a receta that is already paid, leaves the payment untouched
     * (an already-paid receta keeps its original `pagadaEn`/`pagadaPorId`); unmarking is done from the receta's detail.
     */
    pagada: z.boolean().default(false),
    /** Migration 0093 (E1/E2): required for an ENVIO, forbidden for a RETIRO_PRESENCIAL (checked below, on this field). */
    repartidorId: uuid.optional(),
    /**
     * E4: the domicilio de entrega typed when the receta has none (an envío is registered from PREPARADA, where the receta
     * can no longer be edited). Same trim / max length / blank-is-null rule as the receta form's `domicilioPaciente`.
     * Only meaningful for an ENVIO of a receta without domicilio: anything else is rejected (below, and in the handler).
     */
    domicilio: domicilioPacienteOpcional,
  })
  .superRefine((input, ctx) => {
    const mensaje = mensajeRepartidorSegunModalidad(input.modalidad, input.repartidorId);
    if (mensaje) ctx.addIssue({ code: "custom", message: mensaje, path: ["repartidorId"] });
    if (input.modalidad === "RETIRO_PRESENCIAL" && input.domicilio) {
      ctx.addIssue({ code: "custom", message: MENSAJE_RETIRO_CON_DOMICILIO, path: ["domicilio"] });
    }
  });

/** Pre-default wire shape: `pagada` may be omitted (= false); `repartidorId` is required for an ENVIO only; `domicilio` only for an ENVIO of a receta without one. */
export type RegistrarEntregaInput = z.input<typeof registrarEntregaInput>;

/** Human-readable message for the M14 invariant that can still slip past the pre-checks below under a race (INV-ENT-002) -- mirrors `modules/cierres/application/firmar-cierre.ts`'s `mapDbError`-in-its-own-try/catch discipline (the pipeline's own mapping, in `withTenantTransaction`, only runs once the WHOLE handler throws, too late for a clear message here). */
function mensajeParaInvariante(codigo: string): string {
  if (codigo === "INV-ENT-002") return "No se pudo registrar la entrega: falta el registro de entrega correspondiente.";
  if (codigo === "INV-R14") return MENSAJE_ENTREGA_REQUIERE_PAGO;
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

    let domicilioNuevo: string | null = null;
    if (input.modalidad === "ENVIO") {
      domicilioNuevo = resolverDomicilioParaEnvio(receta.domicilioPaciente, input.domicilio);
      validarRepartidorAsignable(await getRepartidorParaAsignar(tx, session.tenantId, input.repartidorId!));
    }

    if (entregaExigePago(input.modalidad)) {
      validarPagoAlEntregar({ yaPagada: receta.pagada, pagarAhora: input.pagada });
    }

    try {
      // E4: a receta without domicilio gets the typed one (only that column) BEFORE the entrega is inserted. Audited on the
      // receta's own history, like the payment below.
      if (domicilioNuevo !== null) {
        await actualizarDomicilioReceta(tx, session.tenantId, input.recetaId, domicilioNuevo);
        await auditRecord(tx, {
          tenantId: session.tenantId,
          usuarioId: session.usuario.id,
          entidad: "receta",
          entidadId: input.recetaId,
          accion: TipoAccion.MODIFICAR,
          valorAnterior: { domicilioPaciente: receta.domicilioPaciente },
          valorNuevo: { domicilioPaciente: domicilioNuevo },
          contexto: { origen: "entrega" },
        });
      }

      const entrega = await insertEntrega(tx, {
        tenantId: session.tenantId,
        recetaId: input.recetaId,
        modalidad: input.modalidad,
        entregadaPorId: session.usuario.id,
        repartidorId: input.repartidorId,
      });

      // The switch can only record the payment now (never lower it). Audited on the entrega row (before/after, below)
      // and ALSO on the receta's own history. Written before the estado UPDATE (INV-R14, see module doc comment).
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

      const estadoDestino = estadoDestinoEntrega(input.modalidad);
      await actualizarEstadoReceta(tx, session.tenantId, input.recetaId, estadoDestino);

      return {
        output: { id: entrega.id, recetaId: input.recetaId, estado: estadoDestino },
        audit: {
          entidadId: entrega.id,
          valorAnterior: { estadoReceta: receta.estado, pagada: receta.pagada },
          valorNuevo: {
            modalidad: input.modalidad,
            estadoReceta: estadoDestino,
            pagada: receta.pagada || marcarPago,
            ...(input.repartidorId ? { repartidorId: input.repartidorId } : {}),
          },
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
