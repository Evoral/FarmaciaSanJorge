/**
 * `listPreparacionesIniciadas` -- FASE 10, M13a point 10.1, DP-18b: before
 * firming TODAY's jornada, the UI must show every preparación currently
 * `INICIADA` (regardless of when it was started) so the DT can decide
 * before cerrar -- once today is signed, INV-C03 rejects any further
 * movimiento_stock/asiento dated today, so a confirmation attempt on any of
 * these would fail from that point on. Gated on `cierres.firmar` (only the
 * DT, the only role that ever reaches this screen, needs to see it).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listPreparacionesIniciadas as listPreparacionesIniciadasDb } from "../infrastructure/cierre-repository";

export interface PreparacionIniciadaItem {
  id: string;
  fichaTecnicaId: string;
  itemDescripcion: string | null;
  iniciadaEn: Date;
}

export const listPreparacionesIniciadasQuery = defineQuery({
  name: "cierres.preparacionesIniciadas.list",
  permiso: "cierres.firmar",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<PreparacionIniciadaItem[]> => listPreparacionesIniciadasDb(tx, session.tenantId),
});

export async function listPreparacionesIniciadas(): Promise<PreparacionIniciadaItem[]> {
  return listPreparacionesIniciadasQuery.execute({});
}
