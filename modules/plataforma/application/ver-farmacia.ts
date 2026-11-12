/** `/plataforma/farmacias/[id]` (openspec/specs/plataforma/spec.md P9, P16, P17): datos, platform history, cuenta corriente, saldo and integrity incidents. `null` = no such pharmacy. */
import { z } from "zod";
import { uuid } from "@/shared/validation";
import { definePlataforma } from "./define-plataforma";
import { INCIDENTES_DETALLE_LIMITE } from "../domain/farmacia";
import { auditoriaFarmacia, cuentaCorriente, incidentesIntegridad, verFarmacia as verFarmaciaDb } from "../infrastructure/plataforma-repository";

const HISTORIAL_LIMITE = 50;

export const verFarmaciaQuery = definePlataforma({
  name: "plataforma.farmacias.ver",
  input: z.object({ id: uuid }),
  handler: async ({ tx, actor, input }) => {
    const farmacia = await verFarmaciaDb(tx, actor.tokenHash, input.id);
    if (!farmacia) return null;
    const historial = await auditoriaFarmacia(tx, actor.tokenHash, input.id, HISTORIAL_LIMITE);
    const cuenta = await cuentaCorriente(tx, actor.tokenHash, input.id);
    // View-only (P19): reading incidents writes no platform audit row.
    const incidentes = await incidentesIntegridad(tx, actor.tokenHash, [input.id], false, INCIDENTES_DETALLE_LIMITE);
    return { farmacia, historial, cuenta, incidentes };
  },
});

export function verFarmacia(id: string) {
  return verFarmaciaQuery.execute({ id });
}
