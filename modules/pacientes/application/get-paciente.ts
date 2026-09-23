/** `getPaciente` (M06, FASE 4 point 4.5): single-row read for `/catalogos/pacientes/[id]`. HEALTH-ADJACENT DATA (DP-24) -- gated on `pacientes.gestionar`, never logged. */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { getPacienteParaAccion } from "../infrastructure/paciente-repository";
import type { PacienteParaAccion } from "../infrastructure/paciente-repository";

const getPacienteInput = z.object({ id: uuid });

export const getPacienteQuery = defineQuery({
  name: "pacientes.ver",
  permiso: "pacientes.gestionar",
  input: getPacienteInput,
  handler: async ({ tx, session, input }) => getPacienteParaAccion(tx, session.tenantId, input.id),
});

export async function getPaciente(id: string): Promise<PacienteParaAccion | null> {
  return getPacienteQuery.execute({ id });
}
