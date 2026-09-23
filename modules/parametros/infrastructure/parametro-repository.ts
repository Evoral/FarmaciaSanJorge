/**
 * Prisma-backed access to `fsj.parametro` for FASE 3 point 3.10b. Every
 * function here runs inside an ALREADY OPEN tenant transaction (`tx`,
 * handed in by `shared/usecase.ts`'s `defineCommand`/`defineQuery`) --
 * nothing here opens its own transaction. `fsj.parametro` IS tenant-scoped
 * (RLS + INV-T01, migration 0001), but `tenantId` is still passed and
 * filtered on explicitly, same defense-in-depth discipline as every other
 * repository in this codebase (never rely on RLS alone).
 */
import type { Prisma } from "@/generated/prisma/client";

export interface ParametroRow {
  clave: string;
  tipo: string;
  valor: string;
  descripcion: string | null;
  actualizadoEn: Date;
}

/** Only the rows matching `claves` that actually exist for this tenant -- callers (list-parametros.ts) fall back to the domain registry's default for any missing clave. */
export async function listParametrosTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  claves: readonly string[],
): Promise<ParametroRow[]> {
  return tx.parametro.findMany({
    where: { tenantId, clave: { in: [...claves] } },
    select: { clave: true, tipo: true, valor: true, descripcion: true, actualizadoEn: true },
  });
}

export async function getParametroTenant(tx: Prisma.TransactionClient, tenantId: string, clave: string): Promise<ParametroRow | null> {
  return tx.parametro.findUnique({
    where: { tenantId_clave: { tenantId, clave } },
    select: { clave: true, tipo: true, valor: true, descripcion: true, actualizadoEn: true },
  });
}

export interface ActualizarParametroInput {
  tenantId: string;
  clave: string;
  valor: string;
}

/** `fsj_app` is only granted UPDATE (valor, descripcion, actualizado_en) on fsj.parametro (migration 0001) -- this never touches tipo or the (tenantId, clave) PK. */
export async function updateParametroValor(tx: Prisma.TransactionClient, input: ActualizarParametroInput): Promise<void> {
  await tx.parametro.update({
    where: { tenantId_clave: { tenantId: input.tenantId, clave: input.clave } },
    data: { valor: input.valor, actualizadoEn: new Date() },
  });
}
