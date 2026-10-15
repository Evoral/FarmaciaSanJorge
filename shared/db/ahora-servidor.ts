/**
 * Server-side "now" (`SELECT now()`), shared by every module that versions a
 * row by closing the open one and inserting the next (regla_precio,
 * costo_proveedor): the closed row's `vigente_hasta` and the new row's
 * `vigente_desde` are the SAME instant -- no gap or overlap between versions
 * (INV-PL-002: fecha de negocio, del servidor, nunca del cliente).
 * `now()` is the transaction start time, so it is stable for the whole use case.
 */
import type { Prisma } from "@/generated/prisma/client";

export async function ahoraServidor(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<{ ahora: Date }[]>`SELECT now() AS ahora`;
  if (!rows[0]) throw new Error("ahoraServidor: SELECT now() returned no row");
  return rows[0].ahora;
}
