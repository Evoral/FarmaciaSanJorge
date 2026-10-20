/**
 * Prisma-backed access to `fsj.repartidor` (migration 0093). Every function runs inside an ALREADY OPEN tenant
 * transaction (`tx`, handed in by `shared/usecase.ts`), so RLS already restricts every statement to the session's
 * tenant; `tenantId` is still passed on writes (it is part of the row) and used as an extra filter on reads.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { RepartidorOpcion } from "../domain/repartidor";

export interface RepartidorListItem {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string;
  activo: boolean;
}

export interface RepartidorParaAccion extends RepartidorListItem {
  creadoEn: Date;
}

const SELECT_LISTA = { id: true, nombre: true, apellido: true, telefono: true, activo: true } as const;
const SELECT_PARA_ACCION = { ...SELECT_LISTA, creadoEn: true } as const;

// ============================================================================
// Listing (admin screen): text search + activo filter + pagination
// ============================================================================

export interface ListRepartidoresFilter {
  tenantId: string;
  search?: string;
  /** `true` = only active, `false` = only inactive, `undefined` = both. */
  activo?: boolean;
  page: number;
  pageSize: number;
}

export interface ListRepartidoresResult {
  items: RepartidorListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** One OR over nombre / apellido / telefono for a single search term. */
function coincideConTermino(term: string): Prisma.RepartidorWhereInput {
  return {
    OR: [
      { nombre: { contains: term, mode: "insensitive" } },
      { apellido: { contains: term, mode: "insensitive" } },
      { telefono: { contains: term, mode: "insensitive" } },
    ],
  };
}

/** Every whitespace-separated word of `texto` must match some of nombre / apellido / telefono ("perez juan" finds "Pérez, Juan"-style rows regardless of word order). */
function whereTexto(texto: string | undefined): Prisma.RepartidorWhereInput[] {
  const terminos = (texto ?? "").trim().split(/\s+/).filter((t) => t.length > 0);
  return terminos.map(coincideConTermino);
}

export async function listRepartidores(tx: Prisma.TransactionClient, filter: ListRepartidoresFilter): Promise<ListRepartidoresResult> {
  const where: Prisma.RepartidorWhereInput = {
    tenantId: filter.tenantId,
    AND: whereTexto(filter.search),
    ...(filter.activo === undefined ? {} : { activo: filter.activo }),
  };
  const total = await tx.repartidor.count({ where });
  const items = await tx.repartidor.findMany({
    where,
    orderBy: [{ activo: "desc" }, { apellido: "asc" }, { nombre: "asc" }],
    skip: (filter.page - 1) * filter.pageSize,
    take: filter.pageSize,
    select: SELECT_LISTA,
  });
  return { items, total, page: filter.page, pageSize: filter.pageSize };
}

// ============================================================================
// Autocomplete source (entregas modal, "Exportar envíos" dialog)
// ============================================================================

export interface BuscarRepartidoresFilter {
  tenantId: string;
  texto: string;
  soloActivos: boolean;
  limit: number;
}

/** Active ones first, then by apellido / nombre; at most `limit` rows. */
export async function buscarRepartidores(tx: Prisma.TransactionClient, filter: BuscarRepartidoresFilter): Promise<RepartidorOpcion[]> {
  return tx.repartidor.findMany({
    where: { tenantId: filter.tenantId, AND: whereTexto(filter.texto), ...(filter.soloActivos ? { activo: true } : {}) },
    orderBy: [{ activo: "desc" }, { apellido: "asc" }, { nombre: "asc" }],
    take: filter.limit,
    select: SELECT_LISTA,
  });
}

// ============================================================================
// Reads / locks for the action handlers
// ============================================================================

export async function getRepartidor(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<RepartidorParaAccion | null> {
  return tx.repartidor.findFirst({ where: { id, tenantId }, select: SELECT_PARA_ACCION });
}

/** Locks the row (`SELECT ... FOR UPDATE`) BEFORE the caller reads its state, so a concurrent edit / estado change can not interleave (same discipline as modules/etiqueta-tamanos). */
export async function lockRepartidor(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.repartidor WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

// ============================================================================
// Writes
// ============================================================================

export interface RepartidorDatos {
  nombre: string;
  apellido: string;
  telefono: string;
}

export async function insertRepartidor(tx: Prisma.TransactionClient, input: RepartidorDatos & { tenantId: string; creadoPorId: string }): Promise<{ id: string }> {
  return tx.repartidor.create({
    data: { tenantId: input.tenantId, nombre: input.nombre, apellido: input.apellido, telefono: input.telefono, creadoPorId: input.creadoPorId },
    select: { id: true },
  });
}

export async function updateRepartidorDatos(tx: Prisma.TransactionClient, tenantId: string, id: string, datos: RepartidorDatos): Promise<void> {
  await tx.repartidor.updateMany({ where: { id, tenantId }, data: { nombre: datos.nombre, apellido: datos.apellido, telefono: datos.telefono } });
}

export async function cambiarActivoRepartidor(tx: Prisma.TransactionClient, tenantId: string, id: string, activo: boolean): Promise<void> {
  await tx.repartidor.updateMany({ where: { id, tenantId }, data: { activo } });
}
