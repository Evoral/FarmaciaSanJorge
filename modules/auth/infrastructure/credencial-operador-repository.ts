/**
 * `fsj.credencial_operador` (migration 0137): the argon2id hash of an empleado's secret code for an optional
 * verification method (the huella today), one row per (usuario, method). Generic over the method: a new code method
 * stored here needs no change in this file. The PIN is NOT here (`usuario.pin_hash`, ./usuario-repository.ts).
 *
 * Like the PIN's hashes, these never leave modules/auth except through the use cases of this module: the hash is only
 * compared by the code strategy (../application/identificacion-por-codigo.ts).
 */
import type { Prisma } from "@/generated/prisma/client";
import { OPERADOR_ELEGIBLE } from "./operador-elegible";

/** The hashes of the empleados eligible as operador (S7, `OPERADOR_ELEGIBLE`) that hold a credential of this method. */
export async function loadCredencialesDeOperadores(tx: Prisma.TransactionClient, tenantId: string, metodo: string): Promise<{ usuarioId: string; hash: string }[]> {
  return tx.credencialOperador.findMany({
    where: { tenantId, metodo, usuario: { ...OPERADOR_ELEGIBLE } },
    select: { usuarioId: true, hash: true },
  });
}

/**
 * The hashes of this method held by every OTHER usuario of the tenant (no two usuarios share a code, the same rule as
 * the PIN). Takes a per-tenant, per-method transaction-scoped advisory lock first, so two usuarios choosing the same
 * code at once are serialized: the second one sees the first one's hash. Never returns the hashes to a caller outside
 * the uniqueness check. Credentials of a suspended usuario still count: reactivating them must not create a duplicate.
 */
export async function loadCredencialHashesDeOtros(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string, metodo: string): Promise<string[]> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fsj.credencial:' || ${metodo}::text || ':' || ${tenantId}::text))`;
  const filas = await tx.credencialOperador.findMany({
    where: { tenantId, metodo, usuarioId: { not: usuarioId } },
    select: { hash: true },
  });
  return filas.map((fila) => fila.hash);
}

/** Enrols or replaces (the same write) the usuario's credential for the method. Returns whether one already existed. */
export async function upsertCredencialOperador(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string, metodo: string, hash: string, now: Date): Promise<{ existia: boolean }> {
  const actual = await tx.credencialOperador.findUnique({ where: { tenantId_usuarioId_metodo: { tenantId, usuarioId, metodo } }, select: { usuarioId: true } });
  await tx.credencialOperador.upsert({
    where: { tenantId_usuarioId_metodo: { tenantId, usuarioId, metodo } },
    create: { tenantId, usuarioId, metodo, hash, creadoEn: now, actualizadoEn: now },
    update: { hash, actualizadoEn: now },
  });
  return { existia: actual !== null };
}

/** Removes the usuario's credential for the method. Returns whether there was one (the other methods and the PIN stay). */
export async function deleteCredencialOperador(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string, metodo: string): Promise<boolean> {
  const { count } = await tx.credencialOperador.deleteMany({ where: { tenantId, usuarioId, metodo } });
  return count > 0;
}

/** The methods for which the usuario holds a credential (never the hashes): what «Mi cuenta» and Usuarios › detalle show. */
export async function loadMetodosConCredencial(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string): Promise<string[]> {
  const filas = await tx.credencialOperador.findMany({ where: { tenantId, usuarioId }, select: { metodo: true } });
  return filas.map((fila) => fila.metodo);
}
