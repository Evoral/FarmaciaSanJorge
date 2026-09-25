/**
 * `solicitarDestruccion` -- FASE 12 point 12.3a, user decision 5: only from
 * PLAZO_CUMPLIDO -> DESTRUCCION_SOLICITADA, gated on the DT's own full
 * password (verified first, its own transaction -- same "verify
 * credentials, then call a NON-exported internal command" shape as
 * `modules/cierres/application/firmar-cierre.ts`).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { DomainError, NotFoundError, InvariantViolationError, mapDbError } from "@/shared/errors";
import { puedeSolicitarDestruccion } from "../domain/lote-archivo";
import { mensajeParaInvarianteArchivo } from "../domain/mensajes-invariantes";
import { lockLoteParaAccion, solicitarDestruccionDb } from "../infrastructure/archivo-repository";
import { verificarPasswordDestruccionCommand } from "./verificar-password-destruccion";

const solicitarDestruccionInternalInput = z.object({ id: z.string().uuid() });

export interface SolicitarDestruccionInput {
  id: string;
  /** The DT's OWN full password -- never a PIN. Verified before anything else runs. */
  password: string;
}

/** NOT exported -- see this module's doc comment. Reachable only through `solicitarDestruccion`, below. */
const solicitarDestruccionInternalCommand = defineCommand({
  name: "archivo.destruccion.solicitar",
  permiso: "archivo.destruccion.gestionar",
  input: solicitarDestruccionInternalInput,
  audit: { entidad: "lote_archivo_recetas", accion: TipoAccion.CAMBIAR_ESTADO },
  handler: async ({ tx, session, input }) => {
    const lote = await lockLoteParaAccion(tx, session.tenantId, input.id);
    if (!lote) throw new NotFoundError("El lote de archivo no existe.");
    if (!puedeSolicitarDestruccion(lote.estado)) {
      throw new DomainError("Ese lote no está en condiciones de solicitar destrucción: tiene que tener el plazo cumplido.");
    }

    try {
      await solicitarDestruccionDb(tx, session.tenantId, input.id);
    } catch (e) {
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError(mensajeParaInvarianteArchivo(mapped.invariantCode));
      }
      throw mapped;
    }

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        valorAnterior: { estado: "PLAZO_CUMPLIDO" },
        valorNuevo: { estado: "DESTRUCCION_SOLICITADA" },
        motivo: "Solicitud de destrucción de recetas archivadas (papel físico; los registros digitales se conservan).",
      },
    };
  },
});

/** The ONLY exported entry point -- see this module's doc comment. */
export async function solicitarDestruccion(input: SolicitarDestruccionInput, options?: ExecuteOptions): Promise<{ id: string }> {
  const passwordOk = await verificarPasswordDestruccionCommand.execute({ password: input.password }, options);
  if (!passwordOk.ok) {
    throw new DomainError(passwordOk.message);
  }
  return solicitarDestruccionInternalCommand.execute({ id: input.id }, options);
}
