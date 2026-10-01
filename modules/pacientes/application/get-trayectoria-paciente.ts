/**
 * `getTrayectoriaPaciente` (docs/specs/trayectoria-paciente.md): read-only
 * "everything this paciente went through, receta by receta", for
 * `/pacientes/[id]/trayectoria`. HEALTH-ADJACENT DATA (DP-24, Ley 25.326):
 * gated on `pacientes.gestionar`, never logged, and the URL carries only the
 * opaque paciente id and a plain `?page=` integer.
 *
 * `defineQuery` takes ONE permiso (and a denial writes an ACCESO_DENEGADO
 * audit row), so the optional blocks use `can()` instead of other
 * `defineQuery` use cases: presupuesto (`cotizaciones.ver`), preparación
 * (`preparaciones.iniciar`), libro (`libro.ver`) and archivo
 * (`archivo.lotes.gestionar`) are not even queried when the session lacks
 * them. Reads are not audited (project convention). Returns `null` when the
 * paciente does not exist in the tenant (the page answers 404).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { can } from "@/shared/auth/authorize";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { uuid } from "@/shared/validation";
import { PAGE_MAX_TRAYECTORIA, PAGE_SIZE_TRAYECTORIA, armarTrayectoria } from "../domain/trayectoria";
import type { AccesoTrayectoria, TrayectoriaPaciente } from "../domain/trayectoria";
import { getTrayectoriaCruda } from "../infrastructure/trayectoria-repository";

export type { TrayectoriaPaciente };

const getTrayectoriaPacienteInput = z.object({
  pacienteId: uuid,
  page: z.number().int().min(1).max(PAGE_MAX_TRAYECTORIA).default(1),
});

export type GetTrayectoriaPacienteInput = z.input<typeof getTrayectoriaPacienteInput>;

/** Each flag is the permiso of the block / of the target detail page's own layout guard. */
export function accesoTrayectoria(session: AuthenticatedSession): AccesoTrayectoria {
  return {
    presupuesto: can(session, "cotizaciones.ver"),
    preparacion: can(session, "preparaciones.iniciar"),
    libro: can(session, "libro.ver"),
    archivo: can(session, "archivo.lotes.gestionar"),
    linkReceta: can(session, "recetas.crear"),
    linkEntrega: can(session, "entregas.registrar"),
  };
}

export const getTrayectoriaPacienteQuery = defineQuery({
  name: "pacientes.trayectoria",
  permiso: "pacientes.gestionar",
  input: getTrayectoriaPacienteInput,
  handler: async ({ tx, session, input }): Promise<TrayectoriaPaciente | null> => {
    const acceso = accesoTrayectoria(session);
    const cruda = await getTrayectoriaCruda(tx, session.tenantId, input.pacienteId, input.page, PAGE_SIZE_TRAYECTORIA, acceso);
    return cruda ? armarTrayectoria(cruda, acceso) : null;
  },
});

export async function getTrayectoriaPaciente(input: GetTrayectoriaPacienteInput): Promise<TrayectoriaPaciente | null> {
  return getTrayectoriaPacienteQuery.execute(input);
}
