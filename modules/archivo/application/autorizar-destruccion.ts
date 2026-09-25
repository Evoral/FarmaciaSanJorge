/**
 * `autorizarDestruccion` -- FASE 12 point 12.3b, user decision 5: only from
 * DESTRUCCION_SOLICITADA -> DESTRUCCION_AUTORIZADA, expediente non-blank +
 * fecha_autorizacion not future (`validarAutorizacionDestruccion`), gated on
 * the DT's own full password. Same shape as `solicitar-destruccion.ts`.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { DomainError, NotFoundError, InvariantViolationError, mapDbError } from "@/shared/errors";
import { puedeAutorizarDestruccion, validarAutorizacionDestruccion } from "../domain/lote-archivo";
import { mensajeParaInvarianteArchivo } from "../domain/mensajes-invariantes";
import { lockLoteParaAccion, autorizarDestruccionDb, jornadaActualTenant } from "../infrastructure/archivo-repository";
import { verificarPasswordDestruccionCommand } from "./verificar-password-destruccion";

const autorizarDestruccionInternalInput = z.object({
  id: z.string().uuid(),
  expedienteAutorizacion: z.string().trim().min(1, "El número de expediente es obligatorio.").max(200),
  fechaAutorizacion: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Debe tener el formato AAAA-MM-DD."),
});

export interface AutorizarDestruccionInput {
  id: string;
  expedienteAutorizacion: string;
  fechaAutorizacion: string;
  /** The DT's OWN full password -- never a PIN. */
  password: string;
}

/** NOT exported -- see this module's doc comment. Reachable only through `autorizarDestruccion`, below. */
const autorizarDestruccionInternalCommand = defineCommand({
  name: "archivo.destruccion.autorizar",
  permiso: "archivo.destruccion.gestionar",
  input: autorizarDestruccionInternalInput,
  audit: { entidad: "lote_archivo_recetas", accion: TipoAccion.AUTORIZAR },
  handler: async ({ tx, session, input }) => {
    const lote = await lockLoteParaAccion(tx, session.tenantId, input.id);
    if (!lote) throw new NotFoundError("El lote de archivo no existe.");
    if (!puedeAutorizarDestruccion(lote.estado)) {
      throw new DomainError("Ese lote no está en condiciones de autorizar la destrucción: tiene que tener la destrucción solicitada.");
    }

    const jornadaActual = await jornadaActualTenant(tx, session.tenantId);
    const validacion = validarAutorizacionDestruccion({ expedienteAutorizacion: input.expedienteAutorizacion, fechaAutorizacion: input.fechaAutorizacion, jornadaActual });
    if (!validacion.ok) {
      throw new DomainError(validacion.error);
    }

    try {
      await autorizarDestruccionDb(tx, session.tenantId, input.id, { expedienteAutorizacion: input.expedienteAutorizacion, fechaAutorizacion: input.fechaAutorizacion });
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
        valorAnterior: { estado: "DESTRUCCION_SOLICITADA" },
        valorNuevo: { estado: "DESTRUCCION_AUTORIZADA", expedienteAutorizacion: input.expedienteAutorizacion, fechaAutorizacion: input.fechaAutorizacion },
        motivo: `Autorización de destrucción de recetas archivadas (papel físico), expediente ${input.expedienteAutorizacion}.`,
      },
    };
  },
});

/** The ONLY exported entry point -- see this module's doc comment. */
export async function autorizarDestruccion(input: AutorizarDestruccionInput, options?: ExecuteOptions): Promise<{ id: string }> {
  const passwordOk = await verificarPasswordDestruccionCommand.execute({ password: input.password }, options);
  if (!passwordOk.ok) {
    throw new DomainError(passwordOk.message);
  }
  return autorizarDestruccionInternalCommand.execute(
    { id: input.id, expedienteAutorizacion: input.expedienteAutorizacion, fechaAutorizacion: input.fechaAutorizacion },
    options,
  );
}
