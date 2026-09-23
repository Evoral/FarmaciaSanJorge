/**
 * `listUsuariosParaFiltro` (M03, FASE 3 point 3.11). Read-only lookup that
 * feeds the "usuario" filter dropdown on `/auditoria`: the current
 * tenant's own usuarios only (never SISTEMA), so the UI never has to
 * accept a free-typed `usuarioId` from elsewhere. Gated on the SAME
 * `auditoria.ver` permiso as the main listing (this data only exists to
 * build a filter for that screen) -- named distinctly (not `auditoria.ver`
 * itself) since it is a secondary lookup, not the primary action that
 * permiso protects.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listUsuariosParaFiltro as listUsuariosParaFiltroRepo } from "../infrastructure/auditoria-repository";
import type { UsuarioFiltroOption } from "../infrastructure/auditoria-repository";

export const listUsuariosParaFiltroQuery = defineQuery({
  name: "auditoria.ver.usuarios-filtro",
  permiso: "auditoria.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<UsuarioFiltroOption[]> => {
    return listUsuariosParaFiltroRepo(tx, session.tenantId);
  },
});

export async function listUsuariosParaFiltro(): Promise<UsuarioFiltroOption[]> {
  return listUsuariosParaFiltroQuery.execute({});
}
