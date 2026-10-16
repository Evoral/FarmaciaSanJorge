/**
 * `guardarExcipientePreparacion` (migration 0083, docs/specs/libro-recetario-y-contralor.md "Excipiente utilizado"):
 * the toma workspace saves the excipiente actually used as soon as it is typed (optional; blank clears it). Only
 * while the preparación is INICIADA -- at the confirmation ("Imprimir etiquetas") it goes into the ítem's fórmula in
 * the libro recetario asiento, hashed, and the DB freezes it (INV-P08). Permiso `preparaciones.confirmar`, the one
 * "Marcar como preparada" and the confirmation use; no re-authentication (a draft value, nothing is registered yet).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { EXCIPIENTE_MAX, normalizarExcipiente } from "../domain/formula-prescripcion";
import { getItemPrescriptoDePreparacion, getPreparacionParaAccion, lockPreparacionParaAccion, setExcipientePreparacion } from "../infrastructure/preparacion-repository";

const guardarExcipienteInput = z.object({
  preparacionId: uuid,
  excipiente: z.string().max(EXCIPIENTE_MAX, `El excipiente admite hasta ${EXCIPIENTE_MAX} caracteres.`).nullable(),
});

export const guardarExcipientePreparacionCommand = defineCommand({
  name: "preparaciones.excipiente.guardar",
  permiso: "preparaciones.confirmar",
  input: guardarExcipienteInput,
  audit: { entidad: "preparacion", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    if (!(await lockPreparacionParaAccion(tx, session.tenantId, input.preparacionId))) throw new NotFoundError("Preparación no encontrada.");
    const preparacion = await getPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
    if (!preparacion) throw new NotFoundError("Preparación no encontrada.");
    if (preparacion.estado !== "INICIADA") {
      throw new DomainError("El ítem ya quedó registrado en el libro recetario: el excipiente no se puede cambiar.");
    }
    const anterior = (await getItemPrescriptoDePreparacion(tx, session.tenantId, input.preparacionId))?.excipiente ?? null;
    const excipiente = normalizarExcipiente(input.excipiente);
    if (excipiente !== anterior) await setExcipientePreparacion(tx, session.tenantId, input.preparacionId, excipiente);
    return {
      output: { excipiente },
      audit: { entidadId: input.preparacionId, valorAnterior: { excipiente: anterior }, valorNuevo: { excipiente } },
    };
  },
});

export async function guardarExcipientePreparacion(input: z.input<typeof guardarExcipienteInput>): Promise<{ excipiente: string | null }> {
  return guardarExcipientePreparacionCommand.execute(input);
}
