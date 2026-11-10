/** `/plataforma/farmacias/[id]` (openspec/changes/plataforma-superadmin P9): datos + platform history. `null` = no such pharmacy. */
import { z } from "zod";
import { uuid } from "@/shared/validation";
import { definePlataforma } from "./define-plataforma";
import { auditoriaFarmacia, verFarmacia as verFarmaciaDb } from "../infrastructure/plataforma-repository";

const HISTORIAL_LIMITE = 50;

export const verFarmaciaQuery = definePlataforma({
  name: "plataforma.farmacias.ver",
  input: z.object({ id: uuid }),
  handler: async ({ tx, actor, input }) => {
    const farmacia = await verFarmaciaDb(tx, actor.tokenHash, input.id);
    if (!farmacia) return null;
    return { farmacia, historial: await auditoriaFarmacia(tx, actor.tokenHash, input.id, HISTORIAL_LIMITE) };
  },
});

export function verFarmacia(id: string) {
  return verFarmaciaQuery.execute({ id });
}
