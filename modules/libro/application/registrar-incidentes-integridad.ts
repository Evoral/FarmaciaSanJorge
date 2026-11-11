/**
 * `libro.integridad.registrarIncidentes` -- persists what a REAL chain verification found (a cache miss of
 * `resumenIntegridad`) as integrity incidents, so the platform superadmin can see them
 * (openspec/changes/incidentes-integridad-plataforma). The banner never depends on this: the layout builds it first and
 * awaits `registrarIncidentesIntegridad`, which never throws (Next's own control-flow errors aside).
 */
import { z } from "zod";
import { unstable_rethrow } from "next/navigation";
import { defineCommand } from "@/shared/usecase";
import { getLogger } from "@/shared/logging/logger";
import { invalidarResumenIntegridad } from "./resumen-integridad";
import type { VerificacionLibro } from "../domain/integridad";
import { registrarVerificacionLibro } from "../infrastructure/incidente-integridad-repository";

const MAX_LIBROS = 10;

const registrarIncidentesInput = z.object({
  libros: z
    .array(
      z.object({
        libroId: z.string().uuid(),
        /** First broken asiento number as a digit string, or null when the libro verified OK. */
        quiebre: z.string().regex(/^\d+$/).nullable(),
      }),
    )
    .max(MAX_LIBROS),
});

export interface IncidenteAbierto {
  libroId: string;
  quiebre: string;
  incidenteId: string;
}

export interface RegistrarIncidentesOutput {
  tenantId: string;
  /** Only the ABIERTO transitions (a new incident); REPETIDO / CERRADO / SIN_CAMBIO are not reported. */
  abiertos: IncidenteAbierto[];
}

export const registrarIncidentesIntegridadCommand = defineCommand({
  name: "libro.integridad.registrarIncidentes",
  permiso: "libro.ver",
  input: registrarIncidentesInput,
  audit: {
    skip: true,
    reason: "System-detected integrity incident; the row itself is the record and the browsing user did not cause it",
  },
  handler: async ({ tx, session, input }): Promise<{ output: RegistrarIncidentesOutput }> => {
    const abiertos: IncidenteAbierto[] = [];
    for (const { libroId, quiebre } of input.libros) {
      const { transicion, incidenteId } = await registrarVerificacionLibro(tx, libroId, quiebre);
      if (transicion === "ABIERTO" && quiebre !== null && incidenteId !== null) abiertos.push({ libroId, quiebre, incidenteId });
    }
    return { output: { tenantId: session.tenantId, abiertos } };
  },
});

function logSeguro(nivel: "error" | "warn", campos: Record<string, unknown>, mensaje: string): void {
  try {
    getLogger()[nivel](campos, mensaje);
  } catch {
    // Logging itself unavailable (e.g. logger env not configured): the registration is best effort, never break the page.
  }
}

/**
 * Fail-soft entry for the layout. Any failure becomes a `warn`, drops the cached summary (so the next navigation retries) and resolves; Next's control-flow errors (`cookies()`
 * during prerender, redirects) are rethrown first, as `requireSession()` inside the command reads cookies
 * (precedent: modules/auth/application/require-superadmin.ts). The `error` line is logged only after the commit, and
 * only for an incident that was just opened.
 */
export async function registrarIncidentesIntegridad(verificacion: readonly VerificacionLibro[]): Promise<void> {
  if (verificacion.length === 0) return;
  try {
    const { tenantId, abiertos } = await registrarIncidentesIntegridadCommand.execute({
      libros: verificacion.map(({ libroId, quiebre }) => ({ libroId, quiebre })),
    });
    for (const abierto of abiertos) {
      const libroTipo = verificacion.find((v) => v.libroId === abierto.libroId)?.tipo;
      logSeguro("error", { tenantId, libroTipo, quiebre: abierto.quiebre, incidenteId: abierto.incidenteId }, "Libro integrity incident opened");
    }
  } catch (error) {
    unstable_rethrow(error);
    // The verification was cached before the registration ran: drop it so the next navigation verifies (and registers) again.
    invalidarResumenIntegridad();
    logSeguro("warn", { err: error }, "Could not register libro integrity incidents");
  }
}
