/**
 * `registrarDestruccion` -- FASE 12 point 12.3c, user decision 5: only from
 * DESTRUCCION_AUTORIZADA -> DESTRUIDO, fecha_destruccion >= fecha de
 * autorización and not future (`validarRegistroDestruccion`), gated on the
 * DT's own full password. Same shape as `solicitar-destruccion.ts`.
 *
 * User decision 1: DESTRUIDO ONLY means the PHYSICAL papers were destroyed
 * -- this never deletes or mutates any receta/asiento/adjunto row. The
 * audit motivo below says so explicitly, for the paper trail.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { DomainError, NotFoundError, InvariantViolationError, mapDbError } from "@/shared/errors";
import { puedeRegistrarDestruccion, validarRegistroDestruccion } from "../domain/lote-archivo";
import { mensajeParaInvarianteArchivo } from "../domain/mensajes-invariantes";
import { lockLoteParaAccion, registrarDestruccionDb, jornadaActualTenant } from "../infrastructure/archivo-repository";
import { verificarPasswordDestruccionCommand } from "./verificar-password-destruccion";

const registrarDestruccionInternalInput = z.object({
  id: z.string().uuid(),
  fechaDestruccion: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Debe tener el formato AAAA-MM-DD."),
});

export interface RegistrarDestruccionInput {
  id: string;
  fechaDestruccion: string;
  /** The DT's OWN full password -- never a PIN. */
  password: string;
}

/** NOT exported -- see this module's doc comment. Reachable only through `registrarDestruccion`, below. */
const registrarDestruccionInternalCommand = defineCommand({
  name: "archivo.destruccion.registrar",
  permiso: "archivo.destruccion.gestionar",
  input: registrarDestruccionInternalInput,
  audit: { entidad: "lote_archivo_recetas", accion: TipoAccion.DESTRUIR },
  handler: async ({ tx, session, input }) => {
    const lote = await lockLoteParaAccion(tx, session.tenantId, input.id);
    if (!lote) throw new NotFoundError("El lote de archivo no existe.");
    if (!puedeRegistrarDestruccion(lote.estado)) {
      throw new DomainError("Ese lote no está en condiciones de registrar la destrucción: tiene que tener la destrucción autorizada.");
    }
    if (!lote.fechaAutorizacion) {
      // Unreachable given INV-D02 (a lote can't reach DESTRUCCION_AUTORIZADA
      // without fecha_autorizacion), but never trust that alone.
      throw new DomainError("El lote no tiene fecha de autorización registrada.");
    }

    const jornadaActual = await jornadaActualTenant(tx, session.tenantId);
    const validacion = validarRegistroDestruccion({ fechaDestruccion: input.fechaDestruccion, fechaAutorizacion: lote.fechaAutorizacion, jornadaActual });
    if (!validacion.ok) {
      throw new DomainError(validacion.error);
    }

    try {
      await registrarDestruccionDb(tx, session.tenantId, input.id, { fechaDestruccion: input.fechaDestruccion });
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
        valorAnterior: { estado: "DESTRUCCION_AUTORIZADA" },
        valorNuevo: { estado: "DESTRUIDO", fechaDestruccion: input.fechaDestruccion },
        motivo: "Destrucción de las recetas en PAPEL de este lote. Los registros digitales (recetas, asientos, adjuntos) se conservan sin cambios.",
      },
    };
  },
});

/** The ONLY exported entry point -- see this module's doc comment. */
export async function registrarDestruccion(input: RegistrarDestruccionInput, options?: ExecuteOptions): Promise<{ id: string }> {
  const passwordOk = await verificarPasswordDestruccionCommand.execute({ password: input.password }, options);
  if (!passwordOk.ok) {
    throw new DomainError(passwordOk.message);
  }
  return registrarDestruccionInternalCommand.execute({ id: input.id, fechaDestruccion: input.fechaDestruccion }, options);
}
