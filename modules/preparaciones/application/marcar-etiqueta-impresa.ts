/**
 * `marcarEtiquetaImpresa` (M11, FASE 8 point 8.5). `etiquetas.imprimir`.
 * Impression is NOT audited (plan §14: "no se audita ... impresión de
 * etiquetas", mirrored by `modules/elaboracion` never marking a print
 * event either) -- this command's ONLY purpose is flipping the
 * `impresa`/`impresa_en`/`impresa_por_id` columns, idempotently (a second
 * print does not overwrite the first print's timestamp/author).
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { marcarEtiquetaImpresa as marcarEtiquetaImpresaRepo } from "../infrastructure/preparacion-repository";

const marcarEtiquetaImpresaInput = z.object({ etiquetaId: uuid });

export const marcarEtiquetaImpresaCommand = defineCommand({
  name: "etiquetas.marcarImpresa",
  permiso: "etiquetas.imprimir",
  input: marcarEtiquetaImpresaInput,
  audit: { skip: true, reason: "La impresión de etiquetas está explícitamente excluida de la auditoría (plan §14, INV-A01)." },
  handler: async ({ tx, session, input }) => {
    await marcarEtiquetaImpresaRepo(tx, session.tenantId, input.etiquetaId, session.usuario.id);
    return { output: { id: input.etiquetaId } };
  },
});

export async function marcarEtiquetaImpresa(etiquetaId: string): Promise<{ id: string }> {
  return marcarEtiquetaImpresaCommand.execute({ etiquetaId });
}
