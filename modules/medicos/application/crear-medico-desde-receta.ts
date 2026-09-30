/**
 * `crearMedicoDesdeReceta`: the médico quick-create of the receta flow
 * (modules/recetas/ui/medico-picker.tsx, and the PDF import's confirmation
 * later on). docs/specs/importacion-receta-pdf.md "Permisos":
 * `recetas.crear` allows creating médicos INSIDE the receta flow, without
 * `medicos.gestionar`; editing and baja/reactivación stay on
 * `medicos.gestionar` (editar-medico.ts, dar-de-baja-medico.ts,
 * reactivar-medico.ts).
 *
 * Same input, rules and audit entry as `medicos.crear` (crear-medico.ts's
 * `crearMedicoHandler`) -- a separate command only so the permiso is
 * declared, registered and tested on its own.
 */
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { crearMedicoHandler, crearMedicoInput } from "./crear-medico";
import type { CrearMedicoWireInput } from "./crear-medico";

export const crearMedicoDesdeRecetaCommand = defineCommand({
  name: "medicos.crear-desde-receta",
  permiso: "recetas.crear",
  input: crearMedicoInput,
  audit: { entidad: "medico", accion: TipoAccion.CREAR },
  handler: crearMedicoHandler,
});

export async function crearMedicoDesdeReceta(input: CrearMedicoWireInput): Promise<{ id: string }> {
  return crearMedicoDesdeRecetaCommand.execute(input);
}
