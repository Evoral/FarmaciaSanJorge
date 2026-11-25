/**
 * Prisma-backed access for `modules/operadores` (openspec/specs/cuentas-de-sector/spec.md):
 * `fsj.accion_con_pin` (migration 0077) and `fsj.metodo_verificacion_habilitado` (0136). Every function runs inside an already-open tenant transaction.
 *
 * `fsj.accion_con_pin` is also read by the session loader
 * (modules/auth/infrastructure/session-repository.ts#loadPermisosConPin),
 * which is what the use-case pipeline enforces; this module only manages it.
 */
import type { Prisma } from "@/generated/prisma/client";
import { PERMISOS_CON_PIN_CONFIGURABLES, esPermisoConPinConfigurable, type Permiso } from "@/modules/auth/domain/permisos";
import { METODOS_OPCIONALES, type MetodoVerificacion } from "@/modules/auth/domain/verificacion-identidad";
import type { AccionConPin } from "../domain/acciones-con-pin";

/** Every configurable acción, in catalog order, with whether this farmacia asks a PIN for it. */
export async function listAccionesConPin(tx: Prisma.TransactionClient, tenantId: string): Promise<AccionConPin[]> {
  const [permisos, activas] = await Promise.all([
    tx.permiso.findMany({ where: { codigo: { in: [...PERMISOS_CON_PIN_CONFIGURABLES] } }, select: { codigo: true, descripcion: true } }),
    tx.accionConPin.findMany({ where: { tenantId }, select: { permiso: { select: { codigo: true } } } }),
  ]);
  const descripciones = new Map(permisos.map((permiso) => [permiso.codigo, permiso.descripcion]));
  const conPin = new Set(activas.map((fila) => fila.permiso.codigo));
  return PERMISOS_CON_PIN_CONFIGURABLES.map((codigo) => ({ codigo, descripcion: descripciones.get(codigo) ?? codigo, pidePin: conPin.has(codigo) }));
}

/** The configurable acciones currently switched on, in catalog order. */
export async function getCodigosConPin(tx: Prisma.TransactionClient, tenantId: string): Promise<Permiso[]> {
  const activas = await tx.accionConPin.findMany({ where: { tenantId }, select: { permiso: { select: { codigo: true } } } });
  const conPin = new Set(activas.map((fila) => fila.permiso.codigo));
  return PERMISOS_CON_PIN_CONFIGURABLES.filter((codigo) => conPin.has(codigo));
}

/** Replaces the farmacia's set (delete + insert: a pair has nothing to update, see migration 0077's grants). */
export async function replaceAccionesConPin(tx: Prisma.TransactionClient, tenantId: string, codigos: readonly Permiso[]): Promise<void> {
  const permisos = await tx.permiso.findMany({ where: { codigo: { in: codigos.filter(esPermisoConPinConfigurable) } }, select: { id: true } });
  await tx.accionConPin.deleteMany({ where: { tenantId } });
  if (permisos.length > 0) {
    await tx.accionConPin.createMany({ data: permisos.map((permiso) => ({ tenantId, permisoId: permiso.id })) });
  }
}

/** The optional verification methods the farmacia has switched on (`fsj.metodo_verificacion_habilitado`, migration 0136), in catalog order. */
export async function getMetodosHabilitados(tx: Prisma.TransactionClient, tenantId: string): Promise<MetodoVerificacion[]> {
  if (METODOS_OPCIONALES.length === 0) return [];
  const filas = await tx.metodoVerificacionHabilitado.findMany({ where: { tenantId }, select: { metodo: true } });
  const guardados = new Set(filas.map((fila) => fila.metodo));
  return METODOS_OPCIONALES.filter((metodo) => guardados.has(metodo));
}

/**
 * Serializes the saves of a farmacia's set of optional methods: a transaction-scoped advisory lock per tenant. Two
 * Administradores saving at once would otherwise both delete, then both insert the same pair and one would fail on the
 * primary key (23505) instead of waiting. Taken BEFORE the "before" read of the audit too (the command calls it first),
 * so the audit's before/after of the second save describes what the first one left. Re-entrant within a transaction.
 */
export async function lockMetodosHabilitados(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fsj.metodos:' || ${tenantId}::text))`;
}

/** Replaces the farmacia's set of optional methods (delete + insert: a pair has nothing to update, see migration 0136's grants). Touches ONLY that table: the enrolled credentials stay (they are ignored while a method is off). */
export async function replaceMetodosHabilitados(tx: Prisma.TransactionClient, tenantId: string, metodos: readonly MetodoVerificacion[]): Promise<void> {
  await lockMetodosHabilitados(tx, tenantId);
  await tx.metodoVerificacionHabilitado.deleteMany({ where: { tenantId } });
  if (metodos.length > 0) {
    await tx.metodoVerificacionHabilitado.createMany({ data: metodos.map((metodo) => ({ tenantId, metodo })) });
  }
}
