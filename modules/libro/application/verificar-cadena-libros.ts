/** `verificarCadenaLibros` -- FASE 9, M12 point 9.3 (DT verifica integridad de la cadena). */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listLibrosAbiertos, verificarCadenaLibro } from "../infrastructure/asiento-repository";

export interface VerificacionLibro {
  libroId: string;
  tipo: "RECETARIO" | "PSICOTROPICO" | "ESTUPEFACIENTE";
  ok: boolean;
  primerQuiebreNumero: string | null;
}

export const verificarCadenaLibrosQuery = defineQuery({
  name: "libro.integridad.verificar",
  permiso: "libro.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<VerificacionLibro[]> => {
    const libros = await listLibrosAbiertos(tx, session.tenantId);
    const resultados: VerificacionLibro[] = [];
    for (const libro of libros) {
      const quiebre = await verificarCadenaLibro(tx, session.tenantId, libro.id);
      resultados.push({ libroId: libro.id, tipo: libro.tipo, ok: quiebre === null, primerQuiebreNumero: quiebre });
    }
    return resultados;
  },
});

export async function verificarCadenaLibros(): Promise<VerificacionLibro[]> {
  return verificarCadenaLibrosQuery.execute({});
}
