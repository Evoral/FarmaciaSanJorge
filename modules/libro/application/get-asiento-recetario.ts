/** `getAsientoRecetario` -- FASE 9, M12 point 9.1 (detalle de un asiento). */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { NotFoundError } from "@/shared/errors";
import { getAsientoRecetario as getAsientoRecetarioRepo } from "../infrastructure/asiento-repository";
import type { AsientoDetalle } from "../infrastructure/asiento-repository";

const getAsientoRecetarioInput = z.object({ id: uuid });

export const getAsientoRecetarioQuery = defineQuery({
  name: "libro.asientos.ver",
  permiso: "libro.ver",
  input: getAsientoRecetarioInput,
  handler: async ({ tx, session, input }) => {
    const asiento = await getAsientoRecetarioRepo(tx, session.tenantId, input.id);
    if (!asiento) throw new NotFoundError("Asiento no encontrado.");
    return asiento;
  },
});

export async function getAsientoRecetario(id: string): Promise<AsientoDetalle> {
  return getAsientoRecetarioQuery.execute({ id });
}
