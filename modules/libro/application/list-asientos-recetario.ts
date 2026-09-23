/** `listAsientosRecetario` -- FASE 9, M12 point 9.1 (consulta del libro recetario). */
import { defineQuery } from "@/shared/usecase";
import { listAsientosRecetarioFiltro } from "../domain/filtros";
import { listAsientosRecetario as listAsientosRecetarioRepo } from "../infrastructure/asiento-repository";
import type { AsientoListResult } from "../infrastructure/asiento-repository";
import type { ListAsientosRecetarioFiltroInput } from "../domain/filtros";

export const listAsientosRecetarioQuery = defineQuery({
  name: "libro.asientos.listar",
  permiso: "libro.ver",
  input: listAsientosRecetarioFiltro,
  handler: async ({ tx, session, input }) => listAsientosRecetarioRepo(tx, session.tenantId, input),
});

export async function listAsientosRecetario(input: ListAsientosRecetarioFiltroInput): Promise<AsientoListResult> {
  return listAsientosRecetarioQuery.execute(input);
}
