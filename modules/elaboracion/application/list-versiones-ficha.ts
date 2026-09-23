/**
 * `listVersionesFicha` (M10, FASE 7 point 7.2 UI). Read-only, reuses
 * `fichas.generar` (same role set as `fichas.imprimir` -- both are
 * FAR+DT-only per migration 0002's seed, so unlike modules/recetas there is
 * no "broadest" permiso to prefer; `fichas.generar` is picked because
 * listing versions is what you do right before deciding whether to
 * generate another one).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { listVersionesFicha as listVersionesFichaRepo } from "../infrastructure/ficha-repository";
import type { FichaVersionListItem } from "../infrastructure/ficha-repository";

export type { FichaVersionListItem };

const listVersionesFichaInput = z.object({ itemRecetaId: uuid });

export const listVersionesFichaQuery = defineQuery({
  name: "fichas.versiones.listar",
  permiso: "fichas.generar",
  input: listVersionesFichaInput,
  handler: async ({ tx, session, input }) => listVersionesFichaRepo(tx, session.tenantId, input.itemRecetaId),
});

export async function listVersionesFicha(itemRecetaId: string): Promise<FichaVersionListItem[]> {
  return listVersionesFichaQuery.execute({ itemRecetaId });
}
