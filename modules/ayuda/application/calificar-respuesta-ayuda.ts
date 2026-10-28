/**
 * Command use case to rate a recorded help response (CA14).
 *
 * Enforces ownership: only updates the caller's own consultation row
 * (`usuarioId = session.usuario.id`, `tenantId = session.tenantId`).
 * Any mismatch or non-existent record results in a NotFoundError.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { calificarConsultaAyuda } from "../infrastructure/consulta-ayuda-repository";

export const calificarRespuestaAyudaInput = z.object({
  consultaId: z.string().uuid(),
  util: z.boolean(),
});

export type CalificarRespuestaAyudaInput = z.infer<
  typeof calificarRespuestaAyudaInput
>;

export type CalificarRespuestaAyudaOutput = {
  ok: true;
};

export const calificarRespuestaAyudaCommand = defineCommand({
  name: "ayuda.calificarRespuesta",
  permiso: "ayuda.consultar",
  input: calificarRespuestaAyudaInput,
  audit: { skip: true, reason: "fsj.consulta_ayuda is itself the record" },
  handler: async ({
    tx,
    session,
    input,
  }): Promise<{ output: CalificarRespuestaAyudaOutput }> => {
    const actualizado = await calificarConsultaAyuda(tx, {
      id: input.consultaId,
      usuarioId: session.usuario.id,
      util: input.util,
      tenantId: session.tenantId,
    });

    if (!actualizado) {
      throw new NotFoundError("Consulta de ayuda no encontrada.");
    }

    return { output: { ok: true } };
  },
});

export async function calificarRespuestaAyuda(
  input: CalificarRespuestaAyudaInput
): Promise<CalificarRespuestaAyudaOutput> {
  return calificarRespuestaAyudaCommand.execute(input);
}
