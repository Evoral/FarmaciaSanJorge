/** `getRepartidor`: single-row read for `/catalogos/repartidores/[id]` (`repartidores.gestionar`). */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { getRepartidor as getRepartidorRepo } from "../infrastructure/repartidor-repository";
import type { RepartidorParaAccion } from "../infrastructure/repartidor-repository";

export const getRepartidorQuery = defineQuery({
  name: "repartidores.ver",
  permiso: "repartidores.gestionar",
  input: z.object({ id: uuid }).strict(),
  handler: async ({ tx, session, input }) => getRepartidorRepo(tx, session.tenantId, input.id),
});

export async function getRepartidor(id: string): Promise<RepartidorParaAccion | null> {
  return getRepartidorQuery.execute({ id });
}
