/**
 * `listDtParaCoFirma` for FASE 9's anulación de asiento (M12 point 9.2).
 * Feeds the DT picker on the anulación form. Gated on
 * `libro.anulacion.solicitar` (FAR, DT) -- same reasoning as
 * `modules/stock/application/list-dt-para-co-firma.ts`.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listDtVigentesParaCoFirma } from "../infrastructure/co-firma-repository";
import type { DtParaCoFirma } from "../infrastructure/co-firma-repository";

export const listDtParaCoFirmaLibroQuery = defineQuery({
  name: "libro.anulacion.dtParaCoFirma",
  permiso: "libro.anulacion.solicitar",
  input: z.object({}),
  handler: async ({ tx, session }) => listDtVigentesParaCoFirma(tx, session.tenantId),
});

export async function listDtParaCoFirmaLibro(): Promise<DtParaCoFirma[]> {
  return listDtParaCoFirmaLibroQuery.execute({});
}
