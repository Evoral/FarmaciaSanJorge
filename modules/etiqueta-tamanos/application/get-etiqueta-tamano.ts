/** `getEtiquetaTamano`: one size for the admin detail screen (`/admin/configuracion/etiquetas/[id]`). `config.ver`. */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { getEtiquetaTamano as getEtiquetaTamanoRepo } from "../infrastructure/etiqueta-tamano-repository";
import type { EtiquetaTamanoAdmin } from "../infrastructure/etiqueta-tamano-repository";

export const getEtiquetaTamanoQuery = defineQuery({
  name: "etiquetaTamanos.ver",
  permiso: "config.ver",
  input: z.object({ id: uuid }).strict(),
  handler: async ({ tx, session, input }) => getEtiquetaTamanoRepo(tx, session.tenantId, input.id),
});

export async function getEtiquetaTamano(id: string): Promise<EtiquetaTamanoAdmin | null> {
  return getEtiquetaTamanoQuery.execute({ id });
}
