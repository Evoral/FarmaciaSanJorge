/**
 * `resumenIntegridad` -- the libros whose chain is broken, for the app-wide aviso in `app/(app)/layout.tsx`.
 * `fsj.verificar_cadena` walks every asiento, so the layout must not run it on each navigation: the result is kept
 * in memory per tenant for a few minutes (best effort, per server instance) and dropped right after a re-anchor.
 *
 * On a cache MISS the query also returns the raw per-libro result (`verificacion`), which the layout hands to
 * `registrarIncidentesIntegridad`; on a hit it is `null`. The query itself stays read-only.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listLibrosAbiertos, verificarCadenaLibro } from "../infrastructure/asiento-repository";
import type { VerificacionLibro } from "../domain/integridad";

export interface LibroQuebrado {
  tipo: "RECETARIO" | "PSICOTROPICO" | "ESTUPEFACIENTE";
  primerQuiebreNumero: string;
}

export interface ResumenIntegridad {
  quebrados: LibroQuebrado[];
  /** Every open libro's verification on a cache miss (OK ones with `quiebre: null`); `null` on a cache hit. */
  verificacion: VerificacionLibro[] | null;
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
  handler: async ({ tx, session }): Promise<ResumenIntegridad> => {
    const hit = cache.get(session.tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return { quebrados: hit.quebrados, verificacion: null };

    const quebrados: LibroQuebrado[] = [];
    const verificacion: VerificacionLibro[] = [];
    for (const libro of await listLibrosAbiertos(tx, session.tenantId)) {
      const quiebre = await verificarCadenaLibro(tx, session.tenantId, libro.id);
      verificacion.push({ libroId: libro.id, tipo: libro.tipo, quiebre });
      if (quiebre !== null) quebrados.push({ tipo: libro.tipo, primerQuiebreNumero: quiebre });
    }
    cache.set(session.tenantId, { at: Date.now(), quebrados });
    return { quebrados, verificacion };
  },
});

/** The banner contract: only the broken libros. */
export async function resumenIntegridad(): Promise<LibroQuebrado[]> {
  return (await resumenIntegridadQuery.execute({})).quebrados;
}

/** For the layout only: the banner data plus, on a cache miss, the raw verification to register as incidents. */
export async function resumenIntegridadConVerificacion(): Promise<ResumenIntegridad> {
  return resumenIntegridadQuery.execute({});
}
