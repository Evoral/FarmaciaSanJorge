/**
 * Prisma-backed access to `fsj.unidad_medida` for M05 (FASE 4 point 4.1).
 * GLOBAL catalog (DP-39 RESUELTA) -- unlike every other repository in this
 * codebase, these functions take NO `tenantId`: there is nothing to scope by,
 * `fsj.unidad_medida` has no `tenant_id` column and no RLS policy (migration
 * 0006). Every function still runs inside an ALREADY OPEN transaction (`tx`,
 * handed in by `shared/usecase.ts`), same discipline as every other module.
 *
 * The DB is authoritative for INV-M01..M04 (migration 0006's triggers,
 * `fsj.convertir`, the partial unique index on `es_base`) -- nothing here
 * re-implements them.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { TipoMagnitud as PrismaTipoMagnitud } from "@/generated/prisma/enums";

// ============================================================================
// Listing (4.1: search + tipoMagnitud filter + vigente/baja filter + pagination)
// ============================================================================

export interface ListUnidadesFilter {
  search?: string;
  tipoMagnitud?: PrismaTipoMagnitud;
  /** `true` = only fecha_baja IS NULL; `false` = only baja; omitted = both. */
  soloVigentes?: boolean;
  page: number;
  pageSize: number;
}

export interface UnidadListItem {
  id: string;
  codigo: string;
  nombre: string;
  simbolo: string;
  tipoMagnitud: PrismaTipoMagnitud;
  /** Prisma's Decimal (runtime.Decimal), stringified by the caller for display/forms -- see modules/unidades/application for why reads stay as strings. */
  factorABase: string;
  esBase: boolean;
  usada: boolean;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export interface ListUnidadesResult {
  items: UnidadListItem[];
  total: number;
  page: number;
  pageSize: number;
}

function buildWhere(filter: ListUnidadesFilter): Prisma.UnidadMedidaWhereInput {
  const where: Prisma.UnidadMedidaWhereInput = {};

  if (filter.search && filter.search.trim().length > 0) {
    const term = filter.search.trim();
    where.OR = [
      { codigo: { contains: term, mode: "insensitive" } },
      { nombre: { contains: term, mode: "insensitive" } },
      { simbolo: { contains: term, mode: "insensitive" } },
    ];
  }

  if (filter.tipoMagnitud) where.tipoMagnitud = filter.tipoMagnitud;

  if (filter.soloVigentes === true) where.fechaBaja = null;
  else if (filter.soloVigentes === false) where.fechaBaja = { not: null };

  return where;
}

export async function listUnidades(tx: Prisma.TransactionClient, filter: ListUnidadesFilter): Promise<ListUnidadesResult> {
  const where = buildWhere(filter);
  const skip = (filter.page - 1) * filter.pageSize;

  const [total, rows] = await Promise.all([
    tx.unidadMedida.count({ where }),
    tx.unidadMedida.findMany({
      where,
      orderBy: [{ tipoMagnitud: "asc" }, { nombre: "asc" }],
      skip,
      take: filter.pageSize,
      select: { id: true, codigo: true, nombre: true, simbolo: true, tipoMagnitud: true, factorABase: true, esBase: true, usada: true, fechaBaja: true, motivoBaja: true },
    }),
  ]);

  return {
    items: rows.map((row) => ({ ...row, factorABase: row.factorABase.toString() })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

// ============================================================================
// Read for action handlers (crear/editar/baja/reactivar)
// ============================================================================

export interface UnidadParaAccion {
  id: string;
  codigo: string;
  nombre: string;
  simbolo: string;
  tipoMagnitud: PrismaTipoMagnitud;
  factorABase: string;
  esBase: boolean;
  usada: boolean;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export async function getUnidadParaAccion(tx: Prisma.TransactionClient, id: string): Promise<UnidadParaAccion | null> {
  const row = await tx.unidadMedida.findUnique({
    where: { id },
    select: { id: true, codigo: true, nombre: true, simbolo: true, tipoMagnitud: true, factorABase: true, esBase: true, usada: true, fechaBaja: true, motivoBaja: true },
  });
  if (!row) return null;
  return { ...row, factorABase: row.factorABase.toString() };
}

/** `true` if some OTHER unidad already has this codigo. `excludeId` lets editarUnidad ignore the row being edited. */
export async function existeCodigo(tx: Prisma.TransactionClient, codigo: string, excludeId?: string): Promise<boolean> {
  const row = await tx.unidadMedida.findFirst({
    where: { codigo, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return row !== null;
}

/**
 * M3 (review finding): locks the target unidad row (`SELECT ... FOR
 * UPDATE`) BEFORE any caller reads its current state -- same discipline as
 * `modules/usuarios/infrastructure/admin-guard.ts`'s header comment
 * ("lock rows in one ordered statement, then decide from a FRESH read").
 * GLOBAL catalog (DP-39): no `tenantId` to filter by, same as every other
 * function in this repository.
 */
export async function lockUnidadParaAccion(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.unidad_medida WHERE id = ${id}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

/**
 * m1 (review finding, DP-39): truthful "used by N drugs" count ACROSS EVERY
 * TENANT, via migration 0028's `fsj.contar_drogas_por_unidad` SECURITY
 * DEFINER function (fsj_app's own RLS only sees the current tenant's
 * drogas, which would undercount -- see that migration's comment). Returns
 * strictly a number.
 */
export async function contarDrogasQueUsanUnidad(tx: Prisma.TransactionClient, unidadId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ count: number }[]>`
    SELECT fsj.contar_drogas_por_unidad(${unidadId}::uuid) AS count
  `;
  return rows[0]?.count ?? 0;
}

// ============================================================================
// Writes
// ============================================================================

export interface NuevaUnidadInput {
  codigo: string;
  nombre: string;
  simbolo: string;
  tipoMagnitud: PrismaTipoMagnitud;
  factorABase: string;
  esBase: boolean;
}

export async function insertUnidad(tx: Prisma.TransactionClient, input: NuevaUnidadInput): Promise<{ id: string }> {
  return tx.unidadMedida.create({
    data: {
      codigo: input.codigo,
      nombre: input.nombre,
      simbolo: input.simbolo,
      tipoMagnitud: input.tipoMagnitud,
      factorABase: input.factorABase,
      esBase: input.esBase,
    },
    select: { id: true },
  });
}

export interface EditarUnidadInput {
  id: string;
  codigo: string;
  nombre: string;
  simbolo: string;
  /** Omitted entirely when the unit is `usada` -- INV-M04 forbids changing it once used; the UI disables the field, and this repository simply does not include it in the UPDATE in that case (see editar-unidad.ts). */
  tipoMagnitud?: PrismaTipoMagnitud;
  factorABase?: string;
}

export interface EditarUnidadVersion {
  codigo: string;
  nombre: string;
  simbolo: string;
  tipoMagnitud: PrismaTipoMagnitud;
  factorABase: string;
}

/**
 * Optimistic-concurrency UPDATE (same compare-and-swap shape as
 * modules/usuarios/infrastructure/usuario-repository.ts#updateUsuarioDatosPersonales):
 * the WHERE clause requires the row to still match the exact values the edit
 * form was loaded with (`version`). Returns `false` when zero rows matched
 * (row gone, or changed since `version` was read) -- the caller distinguishes
 * those by re-checking existence.
 */
export async function updateUnidadDatos(tx: Prisma.TransactionClient, input: EditarUnidadInput, version: EditarUnidadVersion): Promise<boolean> {
  const result = await tx.unidadMedida.updateMany({
    where: {
      id: input.id,
      codigo: version.codigo,
      nombre: version.nombre,
      simbolo: version.simbolo,
      tipoMagnitud: version.tipoMagnitud,
      factorABase: version.factorABase,
    },
    data: {
      codigo: input.codigo,
      nombre: input.nombre,
      simbolo: input.simbolo,
      ...(input.tipoMagnitud !== undefined ? { tipoMagnitud: input.tipoMagnitud } : {}),
      ...(input.factorABase !== undefined ? { factorABase: input.factorABase } : {}),
    },
  });
  return result.count === 1;
}

export interface CambiarBajaUnidadInput {
  id: string;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export async function cambiarBajaUnidad(tx: Prisma.TransactionClient, input: CambiarBajaUnidadInput): Promise<void> {
  await tx.unidadMedida.update({
    where: { id: input.id },
    data: { fechaBaja: input.fechaBaja, motivoBaja: input.motivoBaja },
  });
}
