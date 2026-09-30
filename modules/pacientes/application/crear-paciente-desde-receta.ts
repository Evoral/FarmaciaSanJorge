/**
 * `crearPacienteDesdeReceta`: the paciente quick-create of the receta flow
 * (modules/recetas/ui/paciente-picker.tsx, and the PDF import's
 * confirmation later on). docs/specs/importacion-receta-pdf.md "Permisos":
 * `recetas.crear` allows creating pacientes INSIDE the receta flow, without
 * `pacientes.gestionar`; editing and baja/reactivación stay on
 * `pacientes.gestionar` (editar-paciente.ts, dar-de-baja-paciente.ts,
 * reactivar-paciente.ts).
 *
 * Same input, rules and audit entry as `pacientes.crear` (crear-paciente.ts's
 * `crearPacienteHandler`, same DP-24 discipline) -- a separate command only
 * so the permiso is declared, registered and tested on its own.
 */
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { crearPacienteHandler, crearPacienteInput } from "./crear-paciente";
import type { CrearPacienteWireInput } from "./crear-paciente";

export const crearPacienteDesdeRecetaCommand = defineCommand({
  name: "pacientes.crear-desde-receta",
  permiso: "recetas.crear",
  input: crearPacienteInput,
  audit: { entidad: "paciente", accion: TipoAccion.CREAR },
  handler: crearPacienteHandler,
});

export async function crearPacienteDesdeReceta(input: CrearPacienteWireInput): Promise<{ id: string }> {
  return crearPacienteDesdeRecetaCommand.execute(input);
}
