/**
 * Prisma-backed access for `modules/operadores` (openspec/specs/cuentas-de-sector/spec.md):
 * `fsj.accion_con_pin` (migration 0077) and the empleados a cuenta de sector
 * can pick. Every function runs inside an already-open tenant transaction.
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

export interface OperadorOpcion {
  id: string;
  nombre: string;
  apellido: string;
}

/**
 * The empleados a cuenta de sector offers in its "¿quién sos?" selector:
 * ACTIVO people (never a cuenta de sector nor the technical usuario) who
 * have a PIN configured and no pending password change (a temporary
 * password, openspec/specs/contrasena-temporal/spec.md). A blocked PIN is still listed -- its owner must see
 * themselves and be told why it fails.
 */
export async function listOperadores(tx: Prisma.TransactionClient, tenantId: string): Promise<OperadorOpcion[]> {
  return tx.usuario.findMany({
    where: { tenantId, estado: "ACTIVO", esSector: false, esTecnico: false, pinHash: { not: null }, debeCambiarPassword: false },
    orderBy: [{ apellido: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true, apellido: true },
  });
}
