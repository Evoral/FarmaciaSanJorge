/** `/plataforma/farmacias/[id]` (openspec/changes/plataforma-superadmin P9, P16): datos, platform history, cuenta corriente and saldo. `null` = no such pharmacy. */
import { z } from "zod";
import { uuid } from "@/shared/validation";
import { definePlataforma } from "./define-plataforma";
import { auditoriaFarmacia, cuentaCorriente, verFarmacia as verFarmaciaDb } from "../infrastructure/plataforma-repository";

const HISTORIAL_LIMITE = 50;

export const verFarmaciaQuery = definePlataforma({
  name: "plataforma.farmacias.ver",
  input: z.object({ id: uuid }),
  handler: async ({ tx, actor, input }) => {
    const farmacia = await verFarmaciaDb(tx, actor.tokenHash, input.id);
    if (!farmacia) return null;
    const historial = await auditoriaFarmacia(tx, actor.tokenHash, input.id, HISTORIAL_LIMITE);
    const cuenta = await cuentaCorriente(tx, actor.tokenHash, input.id);
    return { farmacia, historial, cuenta };
  },
});

export function verFarmacia(id: string) {
  return verFarmaciaQuery.execute({ id });
}
