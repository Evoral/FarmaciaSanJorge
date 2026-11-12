/**
 * `cargarAvisoIntegridad` -- the integrity block of `app/(app)/layout.tsx` (openspec/changes/incidentes-integridad-plataforma).
 * Gated on the permiso the query enforces (`libro.ver`). The result is cached in memory (resumen-integridad.ts), so this
 * is not a full chain walk per navigation. Only a real verification (cache miss) is registered as integrity incidents.
 * The banner value is fixed before the registration runs, and the registration wrapper never throws (Next control-flow
 * errors aside), so nothing here can change what the user sees. Not `after()`: it throws with `cookies()` in a Server
 * Component (the command reads the session cookie).
 */
import { unstable_rethrow } from "next/navigation";
import { can } from "@/shared/auth/authorize";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { getLogger } from "@/shared/logging/logger";
import { resumenIntegridadConVerificacion, type LibroQuebrado } from "./resumen-integridad";
import { registrarIncidentesIntegridad } from "./registrar-incidentes-integridad";
import type { VerificacionLibro } from "../domain/integridad";

function logSeguro(mensaje: string, error: unknown): void {
  try {
    getLogger().error({ error }, mensaje);
  } catch {
    // Logging itself unavailable: the banner is best effort, never break the page.
  }
}

export async function cargarAvisoIntegridad(session: AuthenticatedSession): Promise<LibroQuebrado[]> {
  if (!can(session, "libro.ver")) return [];

  let librosQuebrados: LibroQuebrado[] = [];
  let verificacion: VerificacionLibro[] | null = null;
  try {
    const resumen = await resumenIntegridadConVerificacion();
    librosQuebrados = resumen.quebrados;
    verificacion = resumen.verificacion;
  } catch (error) {
    unstable_rethrow(error);
    logSeguro("Failed to load libro integridad banner summary", error);
  }
  if (verificacion) {
    try {
      await registrarIncidentesIntegridad(verificacion);
    } catch (error) {
      unstable_rethrow(error);
      logSeguro("Failed to register libro integrity incidents", error);
    }
  }
  return librosQuebrados;
}
