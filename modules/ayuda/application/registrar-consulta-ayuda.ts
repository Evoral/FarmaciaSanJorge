/**
 * Command use case to persist each chat turn (CA11, CA13).
 *
 * Audit: skipped because `fsj.consulta_ayuda` is itself the immutable audit log
 * of help interactions.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { LIMITES_AYUDA } from "../domain/armar-contexto";
import { RESULTADOS_CONSULTA } from "../domain/consulta-ayuda";
import { insertarConsultaAyuda } from "../infrastructure/consulta-ayuda-repository";

export const registrarConsultaAyudaInput = z.object({
  conversacionId: z.string().uuid(),
  pregunta: z.string().trim().min(1).max(LIMITES_AYUDA.pregunta),
  respuesta: z.string().nullable(),
  entradaId: z.string().nullable(),
  resultado: z.enum(RESULTADOS_CONSULTA),
});

export type RegistrarConsultaAyudaInput = z.infer<
  typeof registrarConsultaAyudaInput
>;

export type RegistrarConsultaAyudaOutput = {
  consultaId: string;
};

export const registrarConsultaAyudaCommand = defineCommand({
  name: "ayuda.registrarConsulta",
  permiso: "ayuda.consultar",
  input: registrarConsultaAyudaInput,
  audit: { skip: true, reason: "fsj.consulta_ayuda is itself the record" },
  handler: async ({
    tx,
    session,
    input,
  }): Promise<{ output: RegistrarConsultaAyudaOutput }> => {
    const { id } = await insertarConsultaAyuda(tx, {
      tenantId: session.tenantId,
      usuarioId: session.usuario.id,
      conversacionId: input.conversacionId,
      pregunta: input.pregunta,
      respuesta: input.respuesta,
      entradaId: input.entradaId,
      resultado: input.resultado,
    });

    return { output: { consultaId: id } };
  },
});

export async function registrarConsultaAyuda(
  input: RegistrarConsultaAyudaInput
): Promise<RegistrarConsultaAyudaOutput> {
  return registrarConsultaAyudaCommand.execute(input);
}
