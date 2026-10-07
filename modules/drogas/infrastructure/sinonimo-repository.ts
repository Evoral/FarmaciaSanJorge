/**
 * Prisma access to `fsj.droga_alias` as the drogas module manages it:
 * a droga's synonyms (docs/specs/sinonimos-droga.md, migration 0067).
 * Runs inside the caller's ALREADY OPEN tenant transaction. The DB owns the
 * hard rules (vigente-only uniqueness, INV-DRG-002 name/synonym exclusivity,
 * INV-DRG-003 removal is final, removal on droga baja); the use cases check
 * first only to answer with a readable message.
 */
import type { Prisma } from "@/generated/prisma/client";

export interface SinonimoDroga {
  id: string;
  /** As typed. */
  texto: string;
  creadoEn: Date;
}

/** Vigente synonyms of one droga, alphabetical. */
export async function listSinonimosDeDroga(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<SinonimoDroga[]> {
  return tx.drogaAlias.findMany({
    where: { tenantId, drogaId, fechaBaja: null },
    orderBy: [{ texto: "asc" }],
    select: { id: true, texto: true, creadoEn: true },
  });
}

export async function insertSinonimo(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; drogaId: string; texto: string; aliasNormalizado: string; creadoPorId: string },
): Promise<{ id: string }> {
  return tx.drogaAlias.create({ data: input, select: { id: true } });
}

/** Soft delete; `false` when it was no longer vigente (removed concurrently). */
export async function quitarSinonimo(tx: Prisma.TransactionClient, tenantId: string, id: string, fechaBaja: Date): Promise<boolean> {
  const result = await tx.drogaAlias.updateMany({ where: { id, tenantId, fechaBaja: null }, data: { fechaBaja } });
  return result.count === 1;
}
