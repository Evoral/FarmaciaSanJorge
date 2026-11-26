/**
 * `getFichaParaImprimir` (M10, FASE 7 point 7.3). Read-only, `fichas.imprimir`
 * (plan §7: FAR/DT -- migration 0002 seed). This is the ONLY entry point the
 * PDF route handler (app/api/fichas-tecnicas/[id]/pdf/route.ts) uses to read
 * data: the route handler never opens its own transaction (forbidden by
 * eslint's `shared/db/transaction` restriction anyway) or queries Prisma
 * directly, so the permission check always runs before any patient data is
 * ever read -- see that file's doc comment for why the URL itself carries no
 * patient data, only the ficha's opaque id.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { NotFoundError } from "@/shared/errors";
import { getFichaParaImprimir as getFichaParaImprimirRepo } from "../infrastructure/ficha-repository";
import type { FichaParaImprimir } from "../infrastructure/ficha-repository";

export type { FichaParaImprimir };

const getFichaParaImprimirInput = z.object({ id: uuid });

export const getFichaParaImprimirQuery = defineQuery({
  name: "fichas.imprimir.datos",
  permiso: "fichas.imprimir",
  input: getFichaParaImprimirInput,
  handler: async ({ tx, session, input }) => getFichaParaImprimirEnTx(tx, session.tenantId, input.id),
});

/**
 * The same read inside the caller's transaction (not a use case: the caller already authorized `fichas.imprimir`):
 * the toma workspace's print (modules/preparaciones) adds the preparación's lots to it.
 */
export async function getFichaParaImprimirEnTx(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<FichaParaImprimir> {
  const ficha = await getFichaParaImprimirRepo(tx, tenantId, id);
  if (!ficha) throw new NotFoundError("Ficha técnica no encontrada.");
  return ficha;
}

export async function getFichaParaImprimir(id: string): Promise<FichaParaImprimir> {
  return getFichaParaImprimirQuery.execute({ id });
}
