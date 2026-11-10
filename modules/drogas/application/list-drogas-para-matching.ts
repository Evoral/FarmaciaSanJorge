/**
 * `listDrogasParaMatching` -- returns active drogas with their synonyms and magnitude
 * for matching against external lists or Excel sheets (e.g. relevamiento de existencia inicial).
 * Gated on `stock.relevamiento.editar`.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineQuery } from "@/shared/usecase";
import {
  listDrogasOpciones as listDrogasOpcionesRepo,
  type DrogaOpcion,
} from "../infrastructure/droga-repository";

export type DrogaParaMatching = DrogaOpcion;

export const listDrogasParaMatchingQuery = defineQuery({
  name: "drogas.para-matching",
  permiso: "stock.relevamiento.editar",
  input: z.object({}),
  handler: async ({ tx, session }) => listDrogasParaMatchingEnTx(tx, session.tenantId),
});

export async function listDrogasParaMatching(): Promise<DrogaParaMatching[]> {
  return listDrogasParaMatchingQuery.execute({});
}

export async function listDrogasParaMatchingEnTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<DrogaParaMatching[]> {
  return listDrogasOpcionesRepo(tx, tenantId);
}
