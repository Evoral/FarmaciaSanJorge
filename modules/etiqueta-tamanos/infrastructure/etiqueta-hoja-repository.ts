/**
 * Prisma-backed access to `fsj.etiqueta_hoja` (migration 0096): the ONE sheet of
 * the tenant. Same discipline as `etiqueta-tamano-repository.ts`: every function
 * runs inside an ALREADY OPEN tenant transaction (RLS restricts it to the session's
 * tenant; `tenantId` is still passed and used as an extra filter / written on insert).
 *
 * The measures are `numeric(4,1)`: Prisma hands them back as `Decimal`, converted
 * here to plain numbers and written as fixed one-decimal strings.
 *
 * A tenant with no row (should not happen: migration 0096 and create-tenant.ts seed
 * it) reads as the default A4 / 5 mm, and the first edit inserts it.
 */
import type { Prisma } from "@/generated/prisma/client";
import { HOJA_PREDETERMINADA } from "../domain/etiqueta-hoja";
import type { HojaEtiqueta } from "../domain/etiqueta-hoja";

export async function getEtiquetaHoja(tx: Prisma.TransactionClient, tenantId: string): Promise<HojaEtiqueta> {
  const row = await tx.etiquetaHoja.findFirst({ where: { tenantId }, select: { anchoMm: true, altoMm: true, margenMm: true } });
  return row ? { anchoMm: row.anchoMm.toNumber(), altoMm: row.altoMm.toNumber(), margenMm: row.margenMm.toNumber() } : { ...HOJA_PREDETERMINADA };
}

/** Locks the sheet row (`FOR UPDATE`) BEFORE the sheet edit reads its state and the active sizes, so a size created meanwhile can not slip past the fit check. A missing row locks nothing. */
export async function lockEtiquetaHoja(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT tenant_id FROM fsj.etiqueta_hoja WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
}

/** The counterpart for the size commands (`FOR SHARE`): while a size is checked against the sheet, no sheet edit can commit. */
export async function lockEtiquetaHojaCompartida(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT tenant_id FROM fsj.etiqueta_hoja WHERE tenant_id = ${tenantId}::uuid FOR SHARE`;
}

export async function upsertEtiquetaHoja(tx: Prisma.TransactionClient, tenantId: string, hoja: HojaEtiqueta): Promise<void> {
  const datos = { anchoMm: hoja.anchoMm.toFixed(1), altoMm: hoja.altoMm.toFixed(1), margenMm: hoja.margenMm.toFixed(1) };
  const { count } = await tx.etiquetaHoja.updateMany({ where: { tenantId }, data: { ...datos, updatedAt: new Date() } });
  if (count === 0) await tx.etiquetaHoja.create({ data: { tenantId, ...datos } });
}
