/**
 * Prisma-backed access to `fsj.etiqueta_tamano` (migration 0066). Tenant-
 * scoped: every function runs inside an ALREADY OPEN tenant transaction
 * (`tx`, handed in by `shared/usecase.ts`), so RLS already restricts every
 * statement to the session's tenant; `tenantId` is still passed on writes
 * (it is part of the row) and used as an extra filter on reads, same
 * discipline as every other tenant-scoped repository.
 *
 * `ancho_mm`/`alto_mm` are `numeric(5,1)`: Prisma hands them back as
 * `Decimal`, converted here to plain numbers (a `Decimal` can not cross into
 * a client component) and written as fixed one-decimal strings.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EtiquetaTamano } from "../domain/etiqueta-tamano";

export interface EtiquetaTamanoAdmin extends EtiquetaTamano {
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT_ADMIN = { id: true, nombre: true, anchoMm: true, altoMm: true, activo: true, createdAt: true, updatedAt: true } as const;

function toAdmin(row: { id: string; nombre: string; anchoMm: { toNumber(): number }; altoMm: { toNumber(): number }; activo: boolean; createdAt: Date; updatedAt: Date }): EtiquetaTamanoAdmin {
  return { id: row.id, nombre: row.nombre, anchoMm: row.anchoMm.toNumber(), altoMm: row.altoMm.toNumber(), activo: row.activo, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** Every size of the tenant, deactivated ones included: active first, then by name. */
export async function listEtiquetaTamanos(tx: Prisma.TransactionClient, tenantId: string): Promise<EtiquetaTamanoAdmin[]> {
  const rows = await tx.etiquetaTamano.findMany({ where: { tenantId }, orderBy: [{ activo: "desc" }, { nombre: "asc" }], select: SELECT_ADMIN });
  return rows.map(toAdmin);
}

/** Only the active sizes, by name: what the print dialog offers. */
export async function listEtiquetaTamanosActivos(tx: Prisma.TransactionClient, tenantId: string): Promise<EtiquetaTamano[]> {
  const rows = await tx.etiquetaTamano.findMany({ where: { tenantId, activo: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true, anchoMm: true, altoMm: true } });
  return rows.map((row) => ({ id: row.id, nombre: row.nombre, anchoMm: row.anchoMm.toNumber(), altoMm: row.altoMm.toNumber() }));
}

export async function getEtiquetaTamano(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<EtiquetaTamanoAdmin | null> {
  const row = await tx.etiquetaTamano.findFirst({ where: { id, tenantId }, select: SELECT_ADMIN });
  return row ? toAdmin(row) : null;
}

/** The size, only if it is ACTIVE (a deactivated size can not be printed on). */
export async function getEtiquetaTamanoActivo(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<EtiquetaTamano | null> {
  const row = await tx.etiquetaTamano.findFirst({ where: { id, tenantId, activo: true }, select: { id: true, nombre: true, anchoMm: true, altoMm: true } });
  return row ? { id: row.id, nombre: row.nombre, anchoMm: row.anchoMm.toNumber(), altoMm: row.altoMm.toNumber() } : null;
}

/**
 * `true` if ANOTHER size of the tenant already has this name, compared
 * case-insensitively (mirrors `uq_etiqueta_tamano_tenant_nombre`, which
 * remains the authority). `excludeId` lets an edit ignore the row itself.
 */
export async function existeNombre(tx: Prisma.TransactionClient, tenantId: string, nombre: string, excludeId?: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.etiqueta_tamano
    WHERE tenant_id = ${tenantId}::uuid
      AND lower(nombre) = lower(${nombre})
      AND (${excludeId ?? null}::uuid IS NULL OR id <> ${excludeId ?? null}::uuid)
    LIMIT 1
  `;
  return rows.length > 0;
}

/** Locks the row (`SELECT ... FOR UPDATE`) BEFORE the caller reads its state, so a concurrent edit/baja can not interleave (same discipline as modules/unidades). */
export async function lockEtiquetaTamano(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.etiqueta_tamano WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

export interface NuevoEtiquetaTamano {
  nombre: string;
  anchoMm: number;
  altoMm: number;
}

export async function insertEtiquetaTamano(tx: Prisma.TransactionClient, tenantId: string, input: NuevoEtiquetaTamano): Promise<{ id: string }> {
  return tx.etiquetaTamano.create({
    data: { tenantId, nombre: input.nombre, anchoMm: input.anchoMm.toFixed(1), altoMm: input.altoMm.toFixed(1) },
    select: { id: true },
  });
}

export async function updateEtiquetaTamanoDatos(tx: Prisma.TransactionClient, tenantId: string, id: string, input: NuevoEtiquetaTamano): Promise<void> {
  await tx.etiquetaTamano.updateMany({
    where: { id, tenantId },
    data: { nombre: input.nombre, anchoMm: input.anchoMm.toFixed(1), altoMm: input.altoMm.toFixed(1), updatedAt: new Date() },
  });
}

export async function cambiarActivoEtiquetaTamano(tx: Prisma.TransactionClient, tenantId: string, id: string, activo: boolean): Promise<void> {
  await tx.etiquetaTamano.updateMany({ where: { id, tenantId }, data: { activo, updatedAt: new Date() } });
}
