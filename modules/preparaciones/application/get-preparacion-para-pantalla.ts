/**
 * `getPreparacionParaPantalla` (M11, FASE 8 point 8.2). Read-only,
 * `preparaciones.iniciar` (see list-preparaciones.ts's doc comment for why
 * this module has no dedicated read permiso). The líneas, partidas and the
 * system's proposal come from `construirDatosConfirmacion`
 * (./datos-confirmacion.ts), shared with the toma workspace's confirmation
 * dialog (./get-confirmacion-de-ficha.ts).
 *
 * Also where the screen's "Volver" goes (domain/toma.ts#hrefVolverDePreparacion):
 * the receta's toma workspace while it still has ítems to confirm.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { hrefVolverDePreparacion } from "../domain/toma";
import { getPreparacionParaAccion, getRecetaDePreparacion } from "../infrastructure/preparacion-repository";
import { construirDatosConfirmacion, type DatosConfirmacion } from "./datos-confirmacion";

export type { LineaPantalla } from "./datos-confirmacion";

const getPreparacionParaPantallaInput = z.object({ preparacionId: uuid });

export interface PreparacionParaPantalla extends DatosConfirmacion {
  id: string;
  estado: string;
  /** "← Volver": the receta's toma workspace or the list tab. */
  hrefVolver: string;
}

export const getPreparacionParaPantallaQuery = defineQuery({
  name: "preparaciones.pantalla",
  permiso: "preparaciones.iniciar",
  input: getPreparacionParaPantallaInput,
  handler: async ({ tx, session, input }): Promise<PreparacionParaPantalla> => {
    const preparacion = await getPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
    if (!preparacion) throw new NotFoundError("Preparación no encontrada.");

    const datos = await construirDatosConfirmacion(tx, session.tenantId, preparacion.fichaTecnicaId);
    const receta = await getRecetaDePreparacion(tx, session.tenantId, preparacion.itemRecetaId);
    return {
      ...datos,
      id: preparacion.id,
      estado: preparacion.estado,
      hrefVolver: hrefVolverDePreparacion(preparacion.estado, receta),
    };
  },
});

export async function getPreparacionParaPantalla(preparacionId: string): Promise<PreparacionParaPantalla> {
  return getPreparacionParaPantallaQuery.execute({ preparacionId });
}
