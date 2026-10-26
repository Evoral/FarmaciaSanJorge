/**
 * `reactivarReceta` -- openspec/specs/retiro-vencido/spec.md RV4-RV6. A receta that went to RETIRO_VENCIDO (nobody picked it up)
 * goes back to PREPARADA when the person shows up; from there it is delivered as always.
 *
 *   RV4: only from RETIRO_VENCIDO and while the receta is not in a lote de archivo (INV-R08, migration 0095, is the
 *        backstop). The receta's `preparada_en` clock restarts by itself (trigger trg_receta_preparada_en).
 *   RV5: if ANY confirmed preparado is vencido (`preparacion.fecha_vencimiento` before the tenant's jornada actual), the
 *        reactivation needs the co-firma of a DT vigente in the same act: the DT picks themselves and types their OWN
 *        password, verified here before anything is written.
 *   RV6: the audit row (CAMBIAR_ESTADO on the receta, a nombre del operador) carries the DT who authorized and the
 *        vencimientos; a rejected co-firma is audited and counted against the DT like every other co-firma.
 *
 * Lock BEFORE the fresh read (M3), the same `lockRecetaParaAccion` as `registrarEntrega`: the receta row is the only lock
 * this command takes (the DT's usuario row is updated by the co-firma bookkeeping, after it).
 *
 * The co-firma is the stock module's `verificarCoFirmaDtEnTx` (decision table, argon2, vigencia, lockout bookkeeping,
 * audit of a failure) run INSIDE this transaction: no third copy of the verification. Whether it is needed depends on
 * the preparados read under the receta lock, so it can not be a separate command run beforehand (as the stock ajuste
 * does); instead a rejection is reported as a NORMAL result (`ok: false`) so that the transaction commits the failed-attempt
 * counter and its audit row -- throwing would roll them back and defeat the lockout (see verificar-co-firma-dt.ts). Nothing
 * else has been written by then. `audit: { skip: true }` because of that: the CAMBIAR_ESTADO row is written below, only on success.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
import { DomainError, InvariantViolationError, NotFoundError, ValidationError, mapDbError } from "@/shared/errors";
import { mensajeGlobalParaInvariante } from "@/shared/errors/mensajes-invariantes";
import { formatFechaIso } from "@/shared/format/fecha";
import { uuid } from "@/shared/validation";
import { verificarCoFirmaDtEnTx } from "@/modules/stock/application/verificar-co-firma-dt";
import {
  MENSAJE_REACTIVAR_ARCHIVADA,
  MENSAJE_REACTIVAR_REQUIERE_CO_FIRMA,
  camposFaltantesCoFirma,
  preparadosVencidos,
  validarReactivar,
} from "../domain/retiro-vencido";
import {
  actualizarEstadoReceta,
  getPreparadosConVencimiento,
  getRecetaParaEntrega,
  getRetiroVencidoDeReceta,
  jornadaActualTenant,
  lockRecetaParaAccion,
} from "../infrastructure/entrega-repository";

const reactivarRecetaInput = z.object({
  recetaId: uuid,
  /** The DT who co-signs; only needed (and only verified) when a preparado is vencido (RV5). */
  dtUsuarioId: uuid.optional(),
  /** The DT's own password, checked server-side; never stored nor audited. */
  dtPassword: z.string().min(1).optional(),
});

export type ReactivarRecetaInput = z.input<typeof reactivarRecetaInput>;

/** `ok: false` = the co-firma was rejected (already counted and audited); nothing else was written. */
export type ReactivarRecetaResult = { ok: true; recetaId: string; autorizadoPorId: string | null } | { ok: false; message: string };

/** The one invariant that can still slip past the pre-checks under a race: the receta was archived meanwhile (INV-R08, 0095). */
function mensajeParaInvariante(codigo: string): string {
  if (codigo === "INV-R08") return MENSAJE_REACTIVAR_ARCHIVADA;
  return mensajeGlobalParaInvariante(codigo) ?? "No se pudo reactivar la receta.";
}

export const reactivarRecetaCommand = defineCommand<z.output<typeof reactivarRecetaInput>, ReactivarRecetaResult>({
  name: "entregas.reactivar",
  permiso: "entregas.registrar",
  input: reactivarRecetaInput,
  audit: {
    skip: true,
    reason: "Audits CAMBIAR_ESTADO of the receta manually, only on success; a rejected co-firma is audited inside verificarCoFirmaDtEnTx.",
  },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.recetaId);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const receta = await getRecetaParaEntrega(tx, session.tenantId, input.recetaId);
    const retiro = await getRetiroVencidoDeReceta(tx, session.tenantId, input.recetaId);
    if (!receta || !retiro) throw new NotFoundError("Receta no encontrada.");
    validarReactivar({ estado: receta.estado, loteArchivoId: retiro.loteArchivoId });

    const jornada = await jornadaActualTenant(tx, session.tenantId);
    const vencidos = preparadosVencidos(await getPreparadosConVencimiento(tx, session.tenantId, input.recetaId), jornada);

    let autorizadoPorId: string | undefined;
    if (vencidos.length > 0) {
      const faltantes = camposFaltantesCoFirma(input);
      if (faltantes.length > 0) throw new ValidationError(MENSAJE_REACTIVAR_REQUIERE_CO_FIRMA, { fields: faltantes });
      const coFirma = await verificarCoFirmaDtEnTx(tx, session, { dtUsuarioId: input.dtUsuarioId!, password: input.dtPassword! });
      if (!coFirma.ok) return { output: { ok: false, message: coFirma.message } };
      autorizadoPorId = coFirma.dtUsuarioId;
    }

    try {
      await actualizarEstadoReceta(tx, session.tenantId, input.recetaId, "PREPARADA");
      await auditRecord(tx, {
        tenantId: session.tenantId,
        usuarioId: session.usuario.id,
        entidad: "receta",
        entidadId: input.recetaId,
        accion: TipoAccion.CAMBIAR_ESTADO,
        valorAnterior: { estadoReceta: "RETIRO_VENCIDO" },
        valorNuevo: {
          estadoReceta: "PREPARADA",
          ...(vencidos.length > 0 ? { preparadosVencidos: vencidos.map((v) => `${v.etiqueta} (venció el ${formatFechaIso(v.fechaVencimiento)})`) } : {}),
        },
        ...(autorizadoPorId ? { autorizadoPorId } : {}),
        contexto: { origen: "reactivar-retiro-vencido" },
      });
    } catch (e) {
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError(mensajeParaInvariante(mapped.invariantCode), { cause: mapped });
      }
      throw mapped;
    }

    return { output: { ok: true, recetaId: input.recetaId, autorizadoPorId: autorizadoPorId ?? null } };
  },
});

/** Returns the reactivated receta; a rejected co-firma is an error on the DT's password field with the generic message. */
export async function reactivarReceta(input: ReactivarRecetaInput): Promise<{ recetaId: string }> {
  const result = await reactivarRecetaCommand.execute(input);
  if (!result.ok) throw new DomainError(result.message, { fields: ["dtPassword"] });
  return { recetaId: result.recetaId };
}
