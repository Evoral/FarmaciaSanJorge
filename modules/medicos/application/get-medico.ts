/** `getMedico` (M06, FASE 4 point 4.4): single-row read for `/catalogos/medicos/[id]`. */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { getMedicoParaAccion } from "../infrastructure/medico-repository";
import type { MedicoParaAccion } from "../infrastructure/medico-repository";

const getMedicoInput = z.object({ id: uuid });

export const getMedicoQuery = defineQuery({
  name: "medicos.ver",
  permiso: "medicos.gestionar",
  input: getMedicoInput,
  handler: async ({ tx, session, input }) => getMedicoParaAccion(tx, session.tenantId, input.id),
});

export async function getMedico(id: string): Promise<MedicoParaAccion | null> {
  return getMedicoQuery.execute({ id });
}
