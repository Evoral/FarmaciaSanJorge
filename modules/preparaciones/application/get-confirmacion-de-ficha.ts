/**
 * `getConfirmacionDeFicha`: what the toma workspace's confirmation dialog
 * ("Continuar", ui/continuar-preparacion-dialog.tsx) shows for an ítem's
 * ficha técnica BEFORE any preparación exists -- the same data
 * `/preparaciones/[id]` shows for an INICIADA one (shared builder,
 * ./datos-confirmacion.ts). Read-only, `preparaciones.iniciar` (same as
 * `preparaciones.pantalla`): opening the dialog persists nothing; the
 * preparación is created and confirmed together by
 * `confirmarPreparacionDeFicha` (./confirmar-preparacion-de-ficha.ts).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { getFichaParaIniciar } from "../infrastructure/preparacion-repository";
import { construirDatosConfirmacion, type DatosConfirmacion } from "./datos-confirmacion";

const getConfirmacionDeFichaInput = z.object({ fichaTecnicaId: uuid });

export const getConfirmacionDeFichaQuery = defineQuery({
  name: "preparaciones.confirmacionDeFicha",
  permiso: "preparaciones.iniciar",
  input: getConfirmacionDeFichaInput,
  handler: async ({ tx, session, input }): Promise<DatosConfirmacion> => {
    const ficha = await getFichaParaIniciar(tx, session.tenantId, input.fichaTecnicaId);
    if (!ficha) throw new NotFoundError("Ficha técnica no encontrada.");
    return construirDatosConfirmacion(tx, session.tenantId, ficha.id);
  },
});

export async function getConfirmacionDeFicha(fichaTecnicaId: string): Promise<DatosConfirmacion> {
  return getConfirmacionDeFichaQuery.execute({ fichaTecnicaId });
}
