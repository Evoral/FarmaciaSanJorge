/**
 * `resumenIntegridad` -- the libros whose chain is broken, for the app-wide aviso in `app/(app)/layout.tsx`.
 * `fsj.verificar_cadena` walks every asiento, so the layout must not run it on each navigation: the result is kept
 * in memory per tenant for a few minutes (best effort, per server instance) and dropped right after a re-anchor.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listLibrosAbiertos, verificarCadenaLibro } from "../infrastructure/asiento-repository";

export interface LibroQuebrado {
  tipo: "RECETARIO" | "PSICOTROPICO" | "ESTUPEFACIENTE";
  primerQuiebreNumero: string;
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; quebrados: LibroQuebrado[] }>();

/** Called after a re-anchor so the aviso disappears at once instead of at the end of the TTL. */
export function invalidarResumenIntegridad(): void {
  cache.clear();
}

export const resumenIntegridadQuery = defineQuery({
  name: "libro.integridad.resumen",
  permiso: "libro.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<LibroQuebrado[]> => {
    const hit = cache.get(session.tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.quebrados;

    const quebrados: LibroQuebrado[] = [];
    for (const libro of await listLibrosAbiertos(tx, session.tenantId)) {
      const quiebre = await verificarCadenaLibro(tx, session.tenantId, libro.id);
      if (quiebre !== null) quebrados.push({ tipo: libro.tipo, primerQuiebreNumero: quiebre });
    }
    cache.set(session.tenantId, { at: Date.now(), quebrados });
    return quebrados;
  },
});

export async function resumenIntegridad(): Promise<LibroQuebrado[]> {
  return resumenIntegridadQuery.execute({});
}
