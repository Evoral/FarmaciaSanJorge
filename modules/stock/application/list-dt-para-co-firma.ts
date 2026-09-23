/**
 * `listDtParaCoFirma` (M07, FASE 5 point 5.3). Feeds the DT picker on the
 * ajuste form. Gated on `stock.ajuste.registrar` (FAR, DT -- plan §7) --
 * deliberately NOT `dt.designar` (ADM only,
 * `modules/directores-tecnicos/application/list-usuarios-elegibles.ts`'s
 * own permiso): the operator who needs to pick a DT to co-sign an ajuste is
 * the same FAR/DT who can register one, never necessarily an ADM.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listDtVigentesParaCoFirma } from "../infrastructure/co-firma-repository";
import type { DtParaCoFirma } from "../infrastructure/co-firma-repository";

export const listDtParaCoFirmaQuery = defineQuery({
  name: "stock.ajuste.dtParaCoFirma",
  permiso: "stock.ajuste.registrar",
  input: z.object({}),
  handler: async ({ tx, session }) => listDtVigentesParaCoFirma(tx, session.tenantId),
});

export async function listDtParaCoFirma(): Promise<DtParaCoFirma[]> {
  return listDtParaCoFirmaQuery.execute({});
}
