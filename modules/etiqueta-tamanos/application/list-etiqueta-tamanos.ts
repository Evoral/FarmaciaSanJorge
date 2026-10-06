/**
 * `listEtiquetaTamanos`: every size of the farmacia, deactivated ones
 * included, for the admin screen (`/admin/configuracion/etiquetas`).
 * `config.ver` (ADMINISTRADOR only, like the rest of Configuración).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listEtiquetaTamanos as listEtiquetaTamanosRepo } from "../infrastructure/etiqueta-tamano-repository";
import type { EtiquetaTamanoAdmin } from "../infrastructure/etiqueta-tamano-repository";

export type { EtiquetaTamanoAdmin };

export const listEtiquetaTamanosQuery = defineQuery({
  name: "etiquetaTamanos.listar",
  permiso: "config.ver",
  input: z.object({}).strict(),
  handler: async ({ tx, session }) => listEtiquetaTamanosRepo(tx, session.tenantId),
});

export async function listEtiquetaTamanos(): Promise<EtiquetaTamanoAdmin[]> {
  return listEtiquetaTamanosQuery.execute({});
}
