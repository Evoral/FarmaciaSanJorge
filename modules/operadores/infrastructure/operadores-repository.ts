/**
 * Prisma-backed access for `modules/operadores` (openspec/specs/cuentas-de-sector/spec.md):
 * `fsj.accion_con_pin` (migration 0077). Every function runs inside an already-open tenant transaction.
 *
 * `fsj.accion_con_pin` is also read by the session loader
 * (modules/auth/infrastructure/session-repository.ts#loadPermisosConPin),
 * which is what the use-case pipeline enforces; this module only manages it.
 */
import type { Prisma } from "@/generated/prisma/client";
import { PERMISOS_CON_PIN_CONFIGURABLES, esPermisoConPinConfigurable, type Permiso } from "@/modules/auth/domain/permisos";
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
