/**
 * `editarIncluirExcipientes`: whether the toma's "Incluir excipientes en la etiqueta" switch starts on (migration 0117;
 * every tenant starts off). ADMINISTRADOR only (`config.editar`), audited like the sheet: `fsj.etiqueta_hoja` has no
 * surrogate id, so the audit row's `entidadId` is the tenant. Etiquetas already generated keep their content.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { getIncluirExcipientes, lockEtiquetaHoja, upsertIncluirExcipientes } from "../infrastructure/etiqueta-hoja-repository";

export const editarIncluirExcipientesInput = z.object({ incluirExcipientes: z.boolean() }).strict();

export const editarIncluirExcipientesCommand = defineCommand({
  name: "etiquetaHoja.incluirExcipientes.editar",
  permiso: "config.editar",
  input: editarIncluirExcipientesInput,
  audit: { entidad: "etiqueta_hoja", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    await lockEtiquetaHoja(tx, session.tenantId);
    const actual = await getIncluirExcipientes(tx, session.tenantId);
    await upsertIncluirExcipientes(tx, session.tenantId, input.incluirExcipientes);
    return {
      output: { incluirExcipientes: input.incluirExcipientes },
      audit: { entidadId: session.tenantId, valorAnterior: { incluirExcipientes: actual }, valorNuevo: { incluirExcipientes: input.incluirExcipientes } },
    };
  },
});

export async function editarIncluirExcipientes(incluirExcipientes: boolean): Promise<{ incluirExcipientes: boolean }> {
  return editarIncluirExcipientesCommand.execute({ incluirExcipientes });
}
